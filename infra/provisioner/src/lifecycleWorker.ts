import type { Address, PublicClient } from "viem";
import { prisma } from "@vampchains/db";
import { REGISTRY_ABI } from "./abi.js";
import type { L1WalletClient } from "./l1Client.js";
import type { Provisioner } from "./provisioners/types.js";

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
/// on-chain state. Once funding has run out, flips the on-chain `active`
/// flag via the permissionless `deactivateIfDepleted` (so the rest of the
/// system, e.g. VampBridge.deposit, sees it immediately) and moves the row
/// to DEACTIVATING for teardown.
export async function detectDepletedChains(l1Client: PublicClient, l1Wallet: L1WalletClient, registryAddress: Address) {
  const active = await prisma.chain.findMany({ where: { status: "ACTIVE" } });

  for (const chain of active) {
    const isActive = await l1Client.readContract({
      address: registryAddress,
      abi: REGISTRY_ABI,
      functionName: "isActive",
      args: [chain.chainId],
    });
    if (isActive) continue;

    console.log(`[lifecycle] chain ${chain.chainId} has run out of funding, deactivating`);
    await prisma.chain.update({ where: { id: chain.id }, data: { status: "DEACTIVATING" } });

    try {
      await l1Wallet.writeContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: "deactivateIfDepleted",
        args: [chain.chainId],
      });
    } catch (err) {
      console.warn(`[lifecycle] deactivateIfDepleted tx failed for chain ${chain.chainId} (maybe already inactive):`, err);
    }
  }
}

/// Tears down infra for every DEACTIVATING chain — including ones left over
/// from a previous run whose teardown failed, since this queries by status
/// rather than depending on being called right after detectDepletedChains.
/// Terminal state DEACTIVATED matches "once funding hits zero the chain is
/// gone for good."
export async function teardownDeactivatingChains(provisioner: Provisioner) {
  const deactivating = await prisma.chain.findMany({ where: { status: "DEACTIVATING" } });

  for (const chain of deactivating) {
    try {
      await provisioner.deprovision(chain);
      await prisma.chain.update({ where: { id: chain.id }, data: { status: "DEACTIVATED" } });
      console.log(`[lifecycle] chain ${chain.chainId} is DEACTIVATED`);
    } catch (err) {
      console.error(`[lifecycle] failed to tear down infra for chain ${chain.chainId}, will retry next tick:`, err);
    }
  }
}
