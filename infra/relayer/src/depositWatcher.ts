import type { Address, PublicClient } from "viem";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import type { privateKeyToAccount } from "viem/accounts";
import type { Chain as ChainRow } from "@vampchains/db";
import { prisma } from "@vampchains/db";
import { DEPOSITED_EVENT } from "./abi.js";
import { getLogsChunked } from "./chunkedGetLogs.js";

type SigningAccount = ReturnType<typeof privateKeyToAccount>;

const CURSOR_ID = "bridge-deposits";

/// Scans new VampBridge.Deposited events on L1 and, for each one, mints the
/// equivalent native balance on the target vampchain by sending it a real,
/// signed transaction from the treasury account — no cheat code, this is a
/// real chain. Idempotent: safe to
/// call repeatedly / after a crash, since progress is tracked both by the
/// IndexerCursor (which blocks have been scanned) and per-row `mintedAt`
/// (which deposits have actually been minted, i.e. their mint tx confirmed).
export async function pollDeposits(
  l1Client: PublicClient,
  bridgeAddress: Address,
  confirmations: number,
  treasuryAccount: SigningAccount
) {
  const latest = await l1Client.getBlockNumber();
  const safeLatest = latest > BigInt(confirmations) ? latest - BigInt(confirmations) : 0n;

  // Fresh deployment against a live chain: start from "now", not block 1 —
  // see chainWatcher.ts's pollNewChains for the same reasoning.
  const cursor = await prisma.indexerCursor.upsert({
    where: { id: CURSOR_ID },
    update: {},
    create: { id: CURSOR_ID, lastBlock: safeLatest > 0n ? safeLatest - 1n : 0n },
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
    await handleDeposit(log, treasuryAccount);
  }

  await prisma.indexerCursor.update({ where: { id: CURSOR_ID }, data: { lastBlock: safeLatest } });
}

async function handleDeposit(
  log: {
    args: { chainId?: bigint; from?: Address; recipient?: Address; amount?: bigint; nonce?: bigint };
    transactionHash: `0x${string}` | null;
    logIndex: number | null;
    blockNumber: bigint | null;
  },
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

  const chain = await prisma.chain.findUnique({ where: { chainId } });
  if (!chain || !chain.rpcUrl || chain.status !== "ACTIVE") {
    console.warn(`[deposits] chain ${chainId} not active/provisioned yet, will retry mint for tx ${txHash} later`);
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
    `[deposits] minted ${amount} raw units (${chain.baseTokenDecimals} decimals) as ${nativeAmount} native wei to ${recipient} on chain ${chainId} (tx ${txHash})`
  );
}

/// Native currency on every vampchain is always treated as 18-decimal, the
/// same as ETH — that's what wallets/tooling assume for any EVM chain's
/// native asset, regardless of what the underlying base token's own
/// `decimals()` says. Most real ERC20s are NOT 18 decimals (USDC/USDT are
/// 6), so a raw unit-for-unit mint would be off by orders of magnitude —
/// e.g. depositing 100 USDC (100_000_000 raw units) would mint a balance
/// that displays as 0.0000000000001 in any wallet instead of 100. Scale up
/// to 18-decimal terms so the native balance always displays correctly.
function scaleToNativeUnits(rawAmount: bigint, tokenDecimals: number): bigint {
  if (tokenDecimals > 18) {
    throw new Error(`base token has ${tokenDecimals} decimals; only tokens with <= 18 decimals are supported`);
  }
  return rawAmount * 10n ** BigInt(18 - tokenDecimals);
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

  const hash = await walletClient.sendTransaction({ to: recipient, value: nativeAmount });
  await publicClient.waitForTransactionReceipt({ hash });
}
