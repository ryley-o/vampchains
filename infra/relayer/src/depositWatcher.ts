import type { Address, PublicClient } from "viem";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import type { privateKeyToAccount } from "viem/accounts";
import type { Chain as ChainRow } from "@vampchains/db";
import { prisma } from "@vampchains/db";
import { DEPOSITED_EVENT } from "./abi.js";
import { getLogsChunked } from "./chunkedGetLogs.js";
import { scaleToNativeUnits } from "./units.js";

type SigningAccount = ReturnType<typeof privateKeyToAccount>;

/// Scans new VampBridge.Deposited events on one home chain's bridge and,
/// for each one, mints the equivalent native balance on the target
/// vampchain by sending it a real, signed transaction from the treasury
/// account — no cheat code, this is a real chain. Idempotent: safe to call
/// repeatedly / after a crash, since progress is tracked both by the
/// IndexerCursor (which blocks have been scanned, per home chain +
/// bridge address — see the cursor id below for why the address is part
/// of it) and per-row `mintedAt` (which deposits have actually been
/// minted, i.e. their mint tx confirmed).
export async function pollDeposits(
  l1Client: PublicClient,
  homeChainId: number,
  bridgeAddress: Address,
  confirmations: number,
  treasuryAccount: SigningAccount
) {
  // Cursor id includes bridgeAddress, not just homeChainId — a bridge
  // redeploy must never resume from the old contract's block height (the
  // home chain's own block count keeps climbing regardless of which
  // contract we're watching), or deposits made shortly after a redeploy
  // silently never get scanned. Same bug class as chainWatcher.ts's
  // pollNewChains, caught live in the same session.
  const cursorId = `bridge-deposits-${homeChainId}-${bridgeAddress.toLowerCase()}`;
  const latest = await l1Client.getBlockNumber();
  const safeLatest = latest > BigInt(confirmations) ? latest - BigInt(confirmations) : 0n;

  // Fresh deployment against a live chain: start from "now", not block 1 —
  // see chainWatcher.ts's pollNewChains for the same reasoning.
  const cursor = await prisma.indexerCursor.upsert({
    where: { id: cursorId },
    update: {},
    create: { id: cursorId, lastBlock: safeLatest > 0n ? safeLatest - 1n : 0n },
  });

  const fromBlock = cursor.lastBlock + 1n;
  if (fromBlock > safeLatest) return;

  const logs = await getLogsChunked(l1Client, {
    address: bridgeAddress,
    event: DEPOSITED_EVENT,
    fromBlock,
    toBlock: safeLatest,
  });

  for (const log of logs) {
    await handleDeposit(log, homeChainId, treasuryAccount);
  }

  await prisma.indexerCursor.update({ where: { id: cursorId }, data: { lastBlock: safeLatest } });
}

async function handleDeposit(
  log: {
    args: { chainId?: bigint; from?: Address; recipient?: Address; amount?: bigint; nonce?: bigint };
    transactionHash: `0x${string}` | null;
    logIndex: number | null;
    blockNumber: bigint | null;
  },
  homeChainId: number,
  treasuryAccount: SigningAccount
) {
  const { chainId, from, recipient, amount, nonce } = log.args;
  if (chainId === undefined || !from || !recipient || amount === undefined || nonce === undefined) return;
  if (!log.transactionHash || log.logIndex === null || log.blockNumber === null) return;

  const txHash = log.transactionHash;
  const logIndex = log.logIndex;

  const existing = await prisma.depositEvent.findUnique({
    where: { txHash_logIndex: { txHash, logIndex } },
  });
  if (existing?.mintedAt) return;

  // Scoped by [homeChainId, chainId, status: ACTIVE], never bare chainId —
  // the registry's own chainId is only unique *within one registry
  // deployment* on a home chain (each registry redeploy restarts its own
  // count from 1, see the Chain model's docstring), so a stale/retired
  // registry's chain can share this same (homeChainId, chainId) pair. The
  // relayer only ever cares about the currently-active one regardless, so
  // filtering to status: "ACTIVE" here resolves the ambiguity directly
  // instead of needing the registry address this watcher doesn't track.
  const chain = await prisma.chain.findFirst({ where: { homeChainId, chainId, status: "ACTIVE" } });
  if (!chain || !chain.rpcUrl) {
    console.warn(
      `[deposits] chain ${chainId} on home chain ${homeChainId} not active/provisioned yet, will retry mint for tx ${txHash} later`
    );
    return;
  }

  const record =
    existing ??
    (await prisma.depositEvent.create({
      data: {
        chainDbId: chain.id,
        chainId,
        txHash,
        logIndex,
        blockNumber: log.blockNumber,
        nonce,
        from,
        recipient,
        amount: amount.toString(),
      },
    }));

  const nativeAmount = scaleToNativeUnits(amount, chain.baseTokenDecimals);
  await mintOnSidechain(chain, recipient, nativeAmount, treasuryAccount);
  await prisma.depositEvent.update({ where: { id: record.id }, data: { mintedAt: new Date() } });
  console.log(
    `[deposits] minted ${amount} raw units (${chain.baseTokenDecimals} decimals) as ${nativeAmount} native wei to ${recipient} on chain ${chainId} (home chain ${homeChainId}, tx ${txHash})`
  );
}

/// Sends `nativeAmount` from the treasury account to `recipient` — a real,
/// signed, mined transaction (there's no cheat code on a real chain). Waits
/// for a receipt before returning, so `mintedAt` is only ever set once the
/// mint has actually landed, not merely been submitted.
async function mintOnSidechain(chain: ChainRow, recipient: Address, nativeAmount: bigint, treasuryAccount: SigningAccount) {
  if (!chain.rpcUrl) throw new Error(`chain ${chain.chainId} has no rpcUrl`);

  const vampchain = defineChain({
    id: Number(chain.evmChainId),
    name: `vampchain-${chain.chainId}`,
    nativeCurrency: { name: chain.baseTokenSymbol, symbol: chain.baseTokenSymbol, decimals: 18 },
    rpcUrls: { default: { http: [chain.rpcUrl] } },
  });

  const walletClient = createWalletClient({ account: treasuryAccount, chain: vampchain, transport: http(chain.rpcUrl) });
  const publicClient = createPublicClient({ chain: vampchain, transport: http(chain.rpcUrl) });

  // Zero priority fee: the treasury mints from an unbacked genesis balance,
  // so any tip it paid would land at the Clique signer as "revenue" that
  // isn't backed by real L1 locked funds — see gasContributionWatcher.ts's
  // fee-revenue accounting, which excludes protocol senders precisely so
  // this can't inflate the claimable total. Zero-tip mines fine on the
  // single-signer Clique node (no miner gas-price / txpool price floor set,
  // see infra/sidechain-node/entrypoint.sh).
  const hash = await walletClient.sendTransaction({ to: recipient, value: nativeAmount, maxPriorityFeePerGas: 0n });
  await publicClient.waitForTransactionReceipt({ hash });
}
