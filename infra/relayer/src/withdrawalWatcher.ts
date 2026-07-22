import type { Address } from "viem";
import { createPublicClient, getAddress, http } from "viem";
import type { privateKeyToAccount } from "viem/accounts";
import type { Chain as ChainRow } from "@vampchains/db";
import { prisma } from "@vampchains/db";
import { signClaim, signClaimSwept } from "./eip712.js";
import { scaleFromNativeUnits } from "./units.js";

type SigningAccount = ReturnType<typeof privateKeyToAccount>;

/// Scans a single vampchain's blocks for plain-value transfers to the burn
/// address (the sidechain "withdraw" gesture: send native currency there to
/// redeem the locked base token back on L1) and, for each one found, signs
/// an EIP-712 claim the recipient can submit to VampBridge.claim()
/// themselves. No L1 transaction, no gas spent by us — see docs/ARCHITECTURE.md
/// for why this replaced the original push-based `release()` design.
///
/// A burn *from* the chain's own shared Clique signer/etherbase address
/// (`cliqueSignerAddress`) is treated as swept protocol fee revenue, not a
/// user withdrawal — see feeSweep.ts, which is what actually produces these
/// burns (an admin-triggered `eth_sendTransaction` against the vampchain's
/// own unlocked signer account). Those get a `ClaimSwept` attestation
/// instead of a plain `Claim`, split 50/50 between the protocol treasury
/// and the chain's creator on-chain — see docs/ARCHITECTURE.md "Protocol
/// fee revenue".
///
/// Runs even against a chain the registry has since marked inactive —
/// claim() intentionally doesn't check chain-active status, see
/// VampBridge.sol's docs.
///
/// Deliberately does NOT apply a confirmation delay here the way the L1
/// watchers do — a vampchain is a single-signer Clique node with no other
/// validators, so there's no reorg risk to wait out. Waiting for
/// confirmations on a low-traffic chain that only mines a block per tx can
/// stall forever (confirmations never accrue without new activity).
export async function pollWithdrawals(
  chain: ChainRow,
  signingAccount: SigningAccount,
  l1ChainId: number,
  bridgeAddress: Address,
  burnAddress: Address,
  cliqueSignerAddress: Address
) {
  if (!chain.rpcUrl) return;
  const sideClient = createPublicClient({ transport: http(chain.rpcUrl) });

  const cursorId = `sidechain-burns-${chain.chainId}`;
  const cursor = await prisma.indexerCursor.upsert({
    where: { id: cursorId },
    update: {},
    create: { id: cursorId, lastBlock: 0n },
  });

  const safeLatest = await sideClient.getBlockNumber();
  const fromBlock = cursor.lastBlock + 1n;
  if (fromBlock > safeLatest) return;

  for (let blockNumber = fromBlock; blockNumber <= safeLatest; blockNumber++) {
    const block = await sideClient.getBlock({ blockNumber, includeTransactions: true });
    for (const tx of block.transactions) {
      if (typeof tx === "string") continue; // shouldn't happen with includeTransactions: true
      if (tx.to && getAddress(tx.to) === burnAddress && tx.value > 0n) {
        const isFeeSweep = getAddress(tx.from) === cliqueSignerAddress;
        await handleBurn(
          chain,
          tx.hash,
          tx.from,
          tx.value,
          blockNumber,
          isFeeSweep,
          signingAccount,
          l1ChainId,
          bridgeAddress
        );
      }
    }
  }

  await prisma.indexerCursor.update({ where: { id: cursorId }, data: { lastBlock: safeLatest } });
}

async function handleBurn(
  chain: ChainRow,
  sidechainTxHash: `0x${string}`,
  from: Address,
  nativeAmount: bigint,
  sidechainBlock: bigint,
  isFeeSweep: boolean,
  signingAccount: SigningAccount,
  l1ChainId: number,
  bridgeAddress: Address
) {
  const existing = await prisma.withdrawalEvent.findUnique({ where: { sidechainTxHash } });
  if (existing?.signature) return;

  const amount = scaleFromNativeUnits(nativeAmount, chain.baseTokenDecimals);
  if (amount === 0n) {
    console.warn(
      `[withdrawals] burn of ${nativeAmount} native wei on chain ${chain.chainId} rounds to 0 raw ${chain.baseTokenSymbol} units (${chain.baseTokenDecimals} decimals) — below the minimum representable amount, nothing to claim`
    );
    return;
  }

  const signature = isFeeSweep
    ? await signClaimSwept(signingAccount, {
        l1ChainId,
        bridgeAddress,
        claim: { vampChainId: chain.chainId, amount, sidechainTxHash },
      })
    : await signClaim(signingAccount, {
        l1ChainId,
        bridgeAddress,
        claim: { vampChainId: chain.chainId, to: from, amount, sidechainTxHash },
      });

  await prisma.withdrawalEvent.upsert({
    where: { sidechainTxHash },
    update: { signature },
    create: {
      chainDbId: chain.id,
      chainId: chain.chainId,
      sidechainTxHash,
      sidechainBlock,
      to: from,
      amount: amount.toString(),
      kind: isFeeSweep ? "FEE_SWEEP" : "USER",
      signature,
    },
  });

  console.log(
    `[withdrawals] signed ${isFeeSweep ? "swept-fee" : "user"} claim for ${amount} raw units (from ${from}) on chain ${chain.chainId} (sidechain tx ${sidechainTxHash})`
  );
}
