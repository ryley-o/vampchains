import type { Address, PublicClient } from "viem";
import { getAddress } from "viem";
import type { privateKeyToAccount } from "viem/accounts";
import { prisma } from "@vampchains/db";
import { BRIDGE_ABI, REGISTRY_ABI } from "./abi.js";
import { buildAndSignSnapshot } from "./snapshotBuilder.js";
import type { L1WalletClient } from "./l1Client.js";
import type { Provisioner } from "./provisioners/types.js";

type SigningAccount = ReturnType<typeof privateKeyToAccount>;

/// Provisions infra for every chain the chainWatcher has queued.
export async function provisionPendingChains(provisioner: Provisioner) {
  const pending = await prisma.chain.findMany({ where: { status: "PENDING_PROVISION" } });

  for (const chain of pending) {
    console.log(`[lifecycle] provisioning chain ${chain.chainId} (${chain.symbol})...`);
    await prisma.chain.update({ where: { id: chain.id }, data: { status: "PROVISIONING" } });

    try {
      const { rpcUrl, flyAppName } = await provisioner.provision(chain);
      await prisma.chain.update({ where: { id: chain.id }, data: { status: "ACTIVE", rpcUrl, flyAppName } });
      console.log(`[lifecycle] chain ${chain.chainId} is ACTIVE at ${rpcUrl}`);
    } catch (err) {
      console.error(`[lifecycle] failed to provision chain ${chain.chainId}:`, err);
      await prisma.chain.update({ where: { id: chain.id }, data: { status: "PROVISION_FAILED" } });
    }
  }
}

/// For every chain we believe is ACTIVE, checks the registry's real
/// on-chain state. `isActive` now stays true throughout a chain's grace
/// period (see VampChainRegistry.sol) — merely running low/out of paid
/// funding no longer trips this, only a *genuinely expired* grace window
/// does. Once that's true, flips the on-chain `active` flag via the
/// permissionless `deactivateIfGraceExpired` and moves the row to
/// AWAITING_SNAPSHOT — the node stays up a little longer at this point
/// (not torn down yet), just long enough for `buildAndPublishSnapshots`
/// below to read its final balances before anything is destroyed.
export async function detectGraceExpiredChains(
  l1Client: PublicClient,
  l1Wallet: L1WalletClient,
  homeChainId: number,
  registryAddress: Address
) {
  const active = await prisma.chain.findMany({ where: { homeChainId, status: "ACTIVE" } });

  for (const chain of active) {
    const isActive = await l1Client.readContract({
      address: registryAddress,
      abi: REGISTRY_ABI,
      functionName: "isActive",
      args: [chain.chainId],
    });
    if (isActive) continue;

    console.log(`[lifecycle] chain ${chain.chainId}'s grace period has expired, deactivating`);
    await prisma.chain.update({ where: { id: chain.id }, data: { status: "AWAITING_SNAPSHOT" } });

    try {
      await l1Wallet.writeContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: "deactivateIfGraceExpired",
        args: [chain.chainId],
      });
    } catch (err) {
      console.warn(`[lifecycle] deactivateIfGraceExpired tx failed for chain ${chain.chainId} (maybe already inactive):`, err);
    }
  }
}

/// For every chain awaiting its final snapshot, reads its real final
/// balances (native + every general-bridged wrapped token) directly off
/// the still-running node, builds and signs a Merkle root, and publishes
/// it to VampBridge — see snapshotBuilder.ts and docs/ARCHITECTURE.md
/// "Protocol fee revenue". Once published, the row moves to DEACTIVATING,
/// which is what actually triggers infra teardown (see
/// teardownDeactivatingChains) — the node is kept alive for exactly this
/// window and no longer.
export async function buildAndPublishSnapshots(
  l1Client: PublicClient,
  l1Wallet: L1WalletClient,
  signingAccount: SigningAccount,
  homeChainId: number,
  bridgeAddress: Address,
  treasuryAddress: Address,
  cliqueSignerAddress: Address
) {
  const awaiting = await prisma.chain.findMany({ where: { homeChainId, status: "AWAITING_SNAPSHOT" } });

  for (const chain of awaiting) {
    try {
      const existingRoot = await l1Client.readContract({
        address: bridgeAddress,
        abi: BRIDGE_ABI,
        functionName: "snapshotRoot",
        args: [chain.chainId],
      });

      // Already published (e.g. a previous run got this far but crashed
      // before the status update below landed) — just advance the status.
      const alreadyPublished = existingRoot !== `0x${"0".repeat(64)}`;

      if (!alreadyPublished) {
        const { root, signature } = await buildAndSignSnapshot(
          chain,
          signingAccount,
          homeChainId,
          bridgeAddress,
          treasuryAddress,
          cliqueSignerAddress
        );

        await l1Wallet.writeContract({
          address: bridgeAddress,
          abi: BRIDGE_ABI,
          functionName: "publishSnapshot",
          args: [chain.chainId, root, signature],
        });
        console.log(`[lifecycle] chain ${chain.chainId}: snapshot published, root ${root}`);
      }

      await prisma.chain.update({ where: { id: chain.id }, data: { status: "DEACTIVATING" } });
    } catch (err) {
      console.error(`[lifecycle] failed to build/publish snapshot for chain ${chain.chainId}, will retry next tick:`, err);
    }
  }
}

/// Tears down infra for every DEACTIVATING chain (snapshot already
/// published) — including ones left over from a previous run whose
/// teardown failed, since this queries by status rather than depending on
/// being called right after buildAndPublishSnapshots. Backs up the
/// underlying volume *before* destroying anything, in case the snapshot
/// process ever turns out to have missed something — see
/// `Provisioner.backup`. Terminal state DEACTIVATED matches "once torn
/// down, gone for good" — funds remain claimable via the published
/// snapshot for VampBridge's SNAPSHOT_CLAIM_WINDOW regardless.
export async function teardownDeactivatingChains(provisioner: Provisioner) {
  const deactivating = await prisma.chain.findMany({ where: { status: "DEACTIVATING" } });

  for (const chain of deactivating) {
    try {
      await provisioner.backup(chain);
      await provisioner.deprovision(chain);
      await prisma.chain.update({ where: { id: chain.id }, data: { status: "DEACTIVATED" } });
      console.log(`[lifecycle] chain ${chain.chainId} is DEACTIVATED`);
    } catch (err) {
      console.error(`[lifecycle] failed to tear down infra for chain ${chain.chainId}, will retry next tick:`, err);
    }
  }
}

/// Once a chain's snapshot claim window has genuinely elapsed, sweeps
/// whatever's left unclaimed (native + every general-bridged wrapped
/// token) to the protocol treasury — see VampBridge.sweepUnclaimed. Reads
/// `snapshotPublishedAt` live from the contract rather than trusting any
/// locally-cached timestamp, and simply ignores a `ClaimWindowNotElapsed`
/// or `ZeroAmount` revert (already-swept-to-zero, or window not up yet) as
/// the expected common case rather than a real error — this runs on every
/// tick against every DEACTIVATED chain indefinitely, so it needs to be a
/// harmless no-op far more often than not.
export async function sweepExpiredSnapshots(
  l1Client: PublicClient,
  l1Wallet: L1WalletClient,
  homeChainId: number,
  bridgeAddress: Address
) {
  const deactivated = await prisma.chain.findMany({ where: { homeChainId, status: "DEACTIVATED" } });

  for (const chain of deactivated) {
    const publishedAt = await l1Client.readContract({
      address: bridgeAddress,
      abi: BRIDGE_ABI,
      functionName: "snapshotPublishedAt",
      args: [chain.chainId],
    });
    if (publishedAt === 0n) continue;

    const wrappedTokens = await prisma.wrappedToken.findMany({ where: { chainDbId: chain.id } });
    const tokens: Address[] = [
      "0x0000000000000000000000000000000000000000",
      ...wrappedTokens.map((w) => getAddress(w.l1Token)),
    ];

    for (const token of tokens) {
      try {
        await l1Wallet.writeContract({
          address: bridgeAddress,
          abi: BRIDGE_ABI,
          functionName: "sweepUnclaimed",
          args: [chain.chainId, token],
        });
        console.log(`[lifecycle] chain ${chain.chainId}: swept unclaimed ${token === "0x0000000000000000000000000000000000000000" ? "(native)" : token}`);
      } catch {
        // Expected the overwhelming majority of the time: window not yet
        // elapsed, or this (chainId, token) pair already fully swept.
      }
    }
  }
}
