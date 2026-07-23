import { createPublicClient, getAddress, http } from "viem";
import type { Chain as ChainRow } from "@vampchains/db";
import { prisma } from "@vampchains/db";

/// Walks a vampchain's blocks to attribute real gas spend per sender —
/// "blood given" to that chain's own economy, the public leaderboard
/// feature that sits alongside (but is deliberately outside the trust
/// model of) the three-way protocol/creator/runway fee split. `gasUsed *
/// effectiveGasPrice` per transaction is exactly what its sender actually
/// paid — tip and burned base fee both included, since both are real spend
/// regardless of where they ended up, and this is a leaderboard of what
/// someone gave, not a claim on any one revenue stream.
///
/// Also persists one `TxActivity` row per transaction it touches anyway —
/// this is what lets scan/ show native-currency transfer history for an
/// address, which vanilla geth has no RPC method for on its own. Piggybacking
/// on this watcher's existing per-block/per-tx walk (rather than a second,
/// separate indexer covering the same blocks twice) is the whole point: the
/// only real cost is one extra small upsert per transaction, not a second
/// full RPC scan.
///
/// Deliberately NOT run at the relayer's tight per-tick cadence — this only
/// ever powers a leaderboard and tx-history lookups, never anything that
/// moves money, so a day of staleness is completely fine (see index.ts,
/// which calls this on a much slower interval). Uses the same per-chain
/// IndexerCursor pattern as every other watcher here (cursor id
/// `gas-contribution-${chain.id}`, keyed by the internal DB id since that's
/// unique regardless of which home chain a vampchain came from).
export async function trackGasContributions(chain: ChainRow) {
  if (!chain.rpcUrl) return;
  const sideClient = createPublicClient({ transport: http(chain.rpcUrl) });

  const cursorId = `gas-contribution-${chain.id}`;
  const safeLatest = await sideClient.getBlockNumber();

  const cursor = await prisma.indexerCursor.upsert({
    where: { id: cursorId },
    update: {},
    create: { id: cursorId, lastBlock: safeLatest > 0n ? safeLatest - 1n : 0n },
  });

  const fromBlock = cursor.lastBlock + 1n;
  if (fromBlock > safeLatest) return;

  // Running totals for this pass, merged into the DB once at the end —
  // a single block can easily have multiple transactions from the same
  // sender, and this keeps that from requiring one upsert per transaction.
  const spendByAddress = new Map<string, bigint>();
  let txActivityCount = 0;

  for (let blockNumber = fromBlock; blockNumber <= safeLatest; blockNumber++) {
    const block = await sideClient.getBlock({ blockNumber, includeTransactions: true });
    for (const tx of block.transactions) {
      const receipt = await sideClient.getTransactionReceipt({ hash: tx.hash });
      const spent = receipt.gasUsed * receipt.effectiveGasPrice;
      if (spent > 0n) {
        const key = receipt.from.toLowerCase();
        spendByAddress.set(key, (spendByAddress.get(key) ?? 0n) + spent);
      }

      await prisma.txActivity.upsert({
        where: { chainDbId_txHash: { chainDbId: chain.id, txHash: tx.hash } },
        update: {},
        create: {
          chainDbId: chain.id,
          chainId: chain.chainId,
          txHash: tx.hash,
          blockNumber,
          // Checksummed via getAddress() — matches VerifiedContract's own
          // convention, and specifically avoids a case-mismatch against
          // scan/'s address page, which validates a URL's address with
          // isAddress() (case-insensitive) then queries this table with it
          // as typed, not lowercased.
          from: getAddress(tx.from),
          to: tx.to ? getAddress(tx.to) : null,
          valueNativeWei: tx.value.toString(),
          methodSelector: tx.input && tx.input.length >= 10 ? tx.input.slice(0, 10) : null,
          status: receipt.status,
          timestamp: new Date(Number(block.timestamp) * 1000),
        },
      });
      txActivityCount++;
    }
  }

  for (const [address, spent] of spendByAddress) {
    const existing = await prisma.gasContribution.findUnique({
      where: { chainDbId_address: { chainDbId: chain.id, address } },
    });
    const newTotal = (existing ? BigInt(existing.totalGasSpentNativeWei) : 0n) + spent;
    await prisma.gasContribution.upsert({
      where: { chainDbId_address: { chainDbId: chain.id, address } },
      update: { totalGasSpentNativeWei: newTotal.toString() },
      create: { chainDbId: chain.id, chainId: chain.chainId, address, totalGasSpentNativeWei: newTotal.toString() },
    });
  }

  await prisma.indexerCursor.update({ where: { id: cursorId }, data: { lastBlock: safeLatest } });

  if (spendByAddress.size > 0 || txActivityCount > 0) {
    console.log(
      `[gas-contribution] chain ${chain.chainId}: updated ${spendByAddress.size} address(es), ${txActivityCount} tx(s) through block ${safeLatest}`
    );
  }
}
