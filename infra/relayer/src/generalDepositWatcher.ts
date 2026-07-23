import type { Address, PublicClient } from "viem";
import { createPublicClient, createWalletClient, http } from "viem";
import type { privateKeyToAccount } from "viem/accounts";
import type { Chain as ChainRow } from "@vampchains/db";
import { prisma } from "@vampchains/db";
import { DEPOSITED_TOKEN_EVENT, ERC20_METADATA_ABI, MINT_WRAPPED_ABI } from "./abi.js";
import { getLogsChunked } from "./chunkedGetLogs.js";
import { WRAPPED_TOKEN_FACTORY_ADDRESS } from "./wrappedTokenFactory.js";

type SigningAccount = ReturnType<typeof privateKeyToAccount>;

/// Scans new VampBridge.DepositedToken events on one home chain's bridge —
/// the general-ERC20 counterpart to depositWatcher.ts's pollDeposits, for
/// every token except a chain's own base token (which mints native
/// currency, not a wrapped token — see docs/ARCHITECTURE.md "General ERC20
/// bridging"). For each deposit, deploys (if needed) and mints the
/// equivalent wrapped-token balance via VampWrappedTokenFactory.mintWrapped,
/// using metadata read from the real L1 token — the factory itself can't do
/// that read, since it runs on an isolated vampchain with no visibility
/// into L1 state.
export async function pollGeneralDeposits(
  l1Client: PublicClient,
  homeChainId: number,
  bridgeAddress: Address,
  confirmations: number,
  treasuryAccount: SigningAccount
) {
  // Cursor id includes bridgeAddress, not just homeChainId — same
  // reasoning as depositWatcher.ts's pollDeposits (a bridge redeploy must
  // never resume from the old contract's block height).
  const cursorId = `bridge-deposits-general-${homeChainId}-${bridgeAddress.toLowerCase()}`;
  const latest = await l1Client.getBlockNumber();
  const safeLatest = latest > BigInt(confirmations) ? latest - BigInt(confirmations) : 0n;

  const cursor = await prisma.indexerCursor.upsert({
    where: { id: cursorId },
    update: {},
    create: { id: cursorId, lastBlock: safeLatest > 0n ? safeLatest - 1n : 0n },
  });

  const fromBlock = cursor.lastBlock + 1n;
  if (fromBlock > safeLatest) return;

  const logs = await getLogsChunked(l1Client, {
    address: bridgeAddress,
    event: DEPOSITED_TOKEN_EVENT,
    fromBlock,
    toBlock: safeLatest,
  });

  for (const log of logs) {
    await handleGeneralDeposit(l1Client, log, homeChainId, treasuryAccount);
  }

  await prisma.indexerCursor.update({ where: { id: cursorId }, data: { lastBlock: safeLatest } });
}

async function handleGeneralDeposit(
  l1Client: PublicClient,
  log: {
    args: { chainId?: bigint; token?: Address; recipient?: Address; from?: Address; amount?: bigint; nonce?: bigint };
    transactionHash: `0x${string}` | null;
    logIndex: number | null;
    blockNumber: bigint | null;
  },
  homeChainId: number,
  treasuryAccount: SigningAccount
) {
  const { chainId, token, recipient, from, amount, nonce } = log.args;
  if (chainId === undefined || !token || !recipient || !from || amount === undefined || nonce === undefined) return;
  if (!log.transactionHash || log.logIndex === null || log.blockNumber === null) return;

  const txHash = log.transactionHash;
  const logIndex = log.logIndex;

  const existing = await prisma.depositEvent.findUnique({
    where: { txHash_logIndex: { txHash, logIndex } },
  });
  if (existing?.mintedAt) return;

  // Scoped by [homeChainId, chainId, status: ACTIVE] — see depositWatcher.ts's identical fix.
  const chain = await prisma.chain.findFirst({ where: { homeChainId, chainId, status: "ACTIVE" } });
  if (!chain || !chain.rpcUrl) {
    console.warn(
      `[general-deposits] chain ${chainId} on home chain ${homeChainId} not active/provisioned yet, will retry mint for tx ${txHash} later`
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
        token,
      },
    }));

  const wrapped = await mintWrappedOnSidechain(l1Client, chain, token, recipient, amount, treasuryAccount);
  await prisma.depositEvent.update({ where: { id: record.id }, data: { mintedAt: new Date() } });
  console.log(
    `[general-deposits] minted ${amount} raw units of ${token} (wrapped at ${wrapped}) to ${recipient} on chain ${chainId} (tx ${txHash})`
  );
}

/// Fetches `token`'s real metadata from L1 (the only place it's actually
/// knowable), records/reuses the WrappedToken row, then calls
/// VampWrappedTokenFactory.mintWrapped on the vampchain — deploying the
/// wrapped clone on first use, minting on every call. Waits for a receipt
/// before returning, same discipline as native minting.
async function mintWrappedOnSidechain(
  l1Client: PublicClient,
  chain: ChainRow,
  token: Address,
  recipient: Address,
  amount: bigint,
  treasuryAccount: SigningAccount
): Promise<Address> {
  if (!chain.rpcUrl) throw new Error(`chain ${chain.chainId} has no rpcUrl`);

  let wrappedRow = await prisma.wrappedToken.findUnique({
    where: { chainDbId_l1Token: { chainDbId: chain.id, l1Token: token } },
  });

  let name: string;
  let symbol: string;
  let decimals: number;
  if (wrappedRow) {
    ({ name, symbol, decimals } = wrappedRow);
  } else {
    const [l1Name, l1Symbol, l1Decimals] = await Promise.all([
      l1Client.readContract({ address: token, abi: ERC20_METADATA_ABI, functionName: "name" }),
      l1Client.readContract({ address: token, abi: ERC20_METADATA_ABI, functionName: "symbol" }),
      l1Client.readContract({ address: token, abi: ERC20_METADATA_ABI, functionName: "decimals" }),
    ]);
    // Prefixed so a wrapped token is never visually confused with the real
    // L1 asset it represents — matches the chain's own native currency
    // getting the chain's own name/symbol, not the L1 token's.
    name = `Vampchain ${l1Name}`;
    symbol = `v${l1Symbol}`;
    decimals = l1Decimals;
  }

  const sidePublicClient = createPublicClient({ transport: http(chain.rpcUrl) });
  const sideWalletClient = createWalletClient({ account: treasuryAccount, transport: http(chain.rpcUrl) });

  const hash = await sideWalletClient.writeContract({
    chain: undefined,
    address: WRAPPED_TOKEN_FACTORY_ADDRESS,
    abi: MINT_WRAPPED_ABI,
    functionName: "mintWrapped",
    args: [token, name, symbol, decimals, recipient, amount],
  });
  await sidePublicClient.waitForTransactionReceipt({ hash });

  const wrapped = await sidePublicClient.readContract({
    address: WRAPPED_TOKEN_FACTORY_ADDRESS,
    abi: MINT_WRAPPED_ABI,
    functionName: "wrappedAddressOf",
    args: [token],
  });

  if (!wrappedRow) {
    wrappedRow = await prisma.wrappedToken.upsert({
      where: { chainDbId_l1Token: { chainDbId: chain.id, l1Token: token } },
      update: {},
      create: { chainDbId: chain.id, chainId: chain.chainId, l1Token: token, wrapped, name, symbol, decimals },
    });
  }

  return wrapped;
}
