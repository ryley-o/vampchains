import type { Address } from "viem";
import { createPublicClient, getAddress, http } from "viem";
import type { Chain as ChainRow } from "@vampchains/db";
import { prisma } from "@vampchains/db";
import { BRIDGE_ABI } from "./abi.js";
import type { L1WalletClient } from "./l1WalletClient.js";

/// Scans a single vampchain's blocks for plain-value transfers to the burn
/// address (the sidechain "withdraw" gesture: send native currency there to
/// redeem the locked base token back on L1) and calls VampBridge.release for
/// each one found. Runs even against a chain the registry has since marked
/// inactive — release() intentionally doesn't check chain-active status,
/// see VampBridge.sol's docs.
///
/// Deliberately does NOT apply a confirmation delay here the way the L1
/// watchers do — a vampchain is a single anvil node with no other
/// validators, so there's no reorg risk to wait out. Waiting for
/// confirmations on a low-traffic chain that only mines a block per tx can
/// stall forever (confirmations never accrue without new activity).
export async function pollWithdrawals(
  chain: ChainRow,
  l1Wallet: L1WalletClient,
  bridgeAddress: Address,
  burnAddress: Address
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
        await handleBurn(chain, tx.hash, tx.from, tx.value, blockNumber, l1Wallet, bridgeAddress);
      }
    }
  }

  await prisma.indexerCursor.update({ where: { id: cursorId }, data: { lastBlock: safeLatest } });
}

async function handleBurn(
  chain: ChainRow,
  sidechainTxHash: `0x${string}`,
  to: Address,
  amount: bigint,
  sidechainBlock: bigint,
  l1Wallet: L1WalletClient,
  bridgeAddress: Address
) {
  const existing = await prisma.withdrawalEvent.findUnique({ where: { sidechainTxHash } });
  if (existing?.releasedAt) return;

  const record =
    existing ??
    (await prisma.withdrawalEvent.create({
      data: {
        chainDbId: chain.id,
        chainId: chain.chainId,
        sidechainTxHash,
        sidechainBlock,
        to,
        amount: amount.toString(),
      },
    }));

  const releaseTxHash = await l1Wallet.writeContract({
    address: bridgeAddress,
    abi: BRIDGE_ABI,
    functionName: "release",
    args: [chain.chainId, to, amount, sidechainTxHash],
  });

  await prisma.withdrawalEvent.update({
    where: { id: record.id },
    data: { releaseTxHash, releasedAt: new Date() },
  });
  console.log(`[withdrawals] released ${amount} to ${to} on L1 for chain ${chain.chainId} (L1 tx ${releaseTxHash})`);
}
