import type { Address } from "viem";
import { createPublicClient, getAddress, http } from "viem";
import type { privateKeyToAccount } from "viem/accounts";
import type { Chain as ChainRow } from "@vampchains/db";
import { prisma } from "@vampchains/db";
import { signFeeRevenue } from "./eip712.js";
import { scaleFromNativeUnits } from "./units.js";

type SigningAccount = ReturnType<typeof privateKeyToAccount>;

/// The single per-vampchain block walker: one pass over each new block's
/// transactions (with receipts) feeds three things at once —
///
/// 1. **"Blood given" leaderboard** (`GasContribution`): `gasUsed *
///    effectiveGasPrice` per sender — exactly what they actually paid, tip
///    and burned base fee both included, since this is a leaderboard of
///    what someone gave, not a claim on any one revenue stream. No sender
///    exclusions here on purpose (even protocol accounts "give blood").
///
/// 2. **Tx history for scan/** (`TxActivity`): one row per transaction,
///    the thing that lets scan/ show native-currency history at all
///    (vanilla geth has no such RPC method).
///
/// 3. **Protocol fee revenue accounting** (`Chain.cumulative*NativeWei` +
///    the signed FeeRevenue attestation): per transaction, base fee
///    (`block.baseFeePerGas * gasUsed`, destroyed by the EVM) and tip
///    (`(effectiveGasPrice - baseFeePerGas) * gasUsed`, landing at the
///    never-spending Clique signer/etherbase) are BOTH monotonically
///    accumulating numbers — nothing ever needs to move on the sidechain,
///    it's pure accounting. (An earlier design physically swept tips to
///    the treasury via real transactions, each producing its own one-shot
///    claim signature; unclaimed revenue accumulated as an unbounded pile
///    of individually-submittable signatures instead of one number. This
///    replaced it.) The two components are kept separate in the DB purely
///    for display; ONE attestation over their SUM is what
///    VampBridge.claimFeeRevenue actually consumes, so one L1 transaction
///    always claims everything accrued since the last claim.
///
///    Unlike the leaderboard, revenue accounting EXCLUDES transactions
///    sent by protocol accounts (treasury, Clique signer): the treasury
///    mints from an unbacked genesis balance, so gas it pays destroys/
///    moves only unbacked funds and creates no L1-side surplus — counting
///    it would let a claim eat into real users' backing. With protocol
///    senders excluded, the invariant is exact: lockedBalance on L1
///    exceeds user-circulating supply by exactly the attested total.
///
/// Same precision discipline as everywhere else in this repo: exact
/// native-wei running totals, with the raw base-token-unit figure always
/// scaled fresh from the FULL total (never compounded per-tick), so
/// per-tick rounding dust can't accumulate for low-decimal tokens.
///
/// Runs on its own interval (index.ts, `gasContributionIntervalMs`).
/// Cursor starts at genesis (block 0), not "now" — a vampchain is our own
/// low-traffic single-node geth reached over internal RPC, so complete
/// history is cheap (see the L1 watchers for why THEY skip ahead; that
/// caution doesn't fit here). Cursor id `gas-contribution-${chain.id}`,
/// keyed by internal DB id since that's unique regardless of home chain.
export async function trackChainActivity(
  chain: ChainRow,
  treasuryAddress: Address,
  cliqueSignerAddress: Address,
  signingAccount: SigningAccount,
  l1ChainId: number,
  bridgeAddress: Address
) {
  if (!chain.rpcUrl) return;
  const sideClient = createPublicClient({ transport: http(chain.rpcUrl) });

  const cursorId = `gas-contribution-${chain.id}`;
  const safeLatest = await sideClient.getBlockNumber();

  const cursor = await prisma.indexerCursor.upsert({
    where: { id: cursorId },
    update: {},
    create: { id: cursorId, lastBlock: -1n },
  });

  const fromBlock = cursor.lastBlock + 1n;
  if (fromBlock > safeLatest) return;

  const protocolSenders = new Set([treasuryAddress.toLowerCase(), cliqueSignerAddress.toLowerCase()]);

  // Running totals for this pass, merged into the DB once at the end —
  // a single block can easily have multiple transactions from the same
  // sender, and this keeps that from requiring one upsert per transaction.
  const spendByAddress = new Map<string, bigint>();
  let baseFeeBurnedThisPass = 0n;
  let tipsThisPass = 0n;
  let txActivityCount = 0;

  for (let blockNumber = fromBlock; blockNumber <= safeLatest; blockNumber++) {
    const block = await sideClient.getBlock({ blockNumber, includeTransactions: true });
    const baseFeePerGas = block.baseFeePerGas ?? 0n;

    for (const tx of block.transactions) {
      const receipt = await sideClient.getTransactionReceipt({ hash: tx.hash });
      const spent = receipt.gasUsed * receipt.effectiveGasPrice;
      if (spent > 0n) {
        const key = receipt.from.toLowerCase();
        spendByAddress.set(key, (spendByAddress.get(key) ?? 0n) + spent);
      }

      // Fee revenue: protocol-sent gas is excluded — see module docstring.
      if (!protocolSenders.has(receipt.from.toLowerCase())) {
        baseFeeBurnedThisPass += baseFeePerGas * receipt.gasUsed;
        tipsThisPass += (receipt.effectiveGasPrice - baseFeePerGas) * receipt.gasUsed;
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
          contractAddress: receipt.contractAddress ? getAddress(receipt.contractAddress) : null,
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

  if (baseFeeBurnedThisPass === 0n && tipsThisPass === 0n) {
    await prisma.indexerCursor.update({ where: { id: cursorId }, data: { lastBlock: safeLatest } });
  } else {
    const newBaseTotal = BigInt(chain.cumulativeBaseFeeBurnedNativeWei) + baseFeeBurnedThisPass;
    const newTipsTotal = BigInt(chain.cumulativeTipsNativeWei) + tipsThisPass;
    const newRevenueRaw = scaleFromNativeUnits(newBaseTotal + newTipsTotal, chain.baseTokenDecimals);
    const previousRevenueRaw = BigInt(chain.cumulativeFeeRevenue);

    // Only worth re-signing if the raw-unit figure actually moved — a
    // low-decimal base token can go many passes between one raw unit's
    // worth of native-wei revenue accruing. The exact native-wei totals
    // still advance either way, so nothing is ever lost to deferral.
    if (newRevenueRaw === previousRevenueRaw) {
      await prisma.$transaction([
        prisma.chain.update({
          where: { id: chain.id },
          data: {
            cumulativeBaseFeeBurnedNativeWei: newBaseTotal.toString(),
            cumulativeTipsNativeWei: newTipsTotal.toString(),
          },
        }),
        prisma.indexerCursor.update({ where: { id: cursorId }, data: { lastBlock: safeLatest } }),
      ]);
    } else {
      const signature = await signFeeRevenue(signingAccount, {
        l1ChainId,
        bridgeAddress,
        claim: { vampChainId: chain.chainId, cumulativeRevenue: newRevenueRaw, asOfBlock: safeLatest },
      });

      await prisma.$transaction([
        prisma.chain.update({
          where: { id: chain.id },
          data: {
            cumulativeBaseFeeBurnedNativeWei: newBaseTotal.toString(),
            cumulativeTipsNativeWei: newTipsTotal.toString(),
            cumulativeFeeRevenue: newRevenueRaw.toString(),
            feeRevenueAsOfBlock: safeLatest,
            feeRevenueAttestedAt: new Date(),
            feeRevenueAttestationSignature: signature,
          },
        }),
        prisma.indexerCursor.update({ where: { id: cursorId }, data: { lastBlock: safeLatest } }),
      ]);
      console.log(
        `[activity] chain ${chain.chainId}: attested cumulative fee revenue ${newRevenueRaw} raw units as of block ${safeLatest} (${newTipsTotal} wei tips + ${newBaseTotal} wei base fee)`
      );
    }
  }

  if (spendByAddress.size > 0 || txActivityCount > 0) {
    console.log(
      `[activity] chain ${chain.chainId}: updated ${spendByAddress.size} address(es), ${txActivityCount} tx(s) through block ${safeLatest}`
    );
  }
}
