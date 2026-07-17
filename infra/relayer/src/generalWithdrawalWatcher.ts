import type { Address } from "viem";
import { createPublicClient, http } from "viem";
import type { privateKeyToAccount } from "viem/accounts";
import type { Chain as ChainRow } from "@vampchains/db";
import { prisma } from "@vampchains/db";
import { TRANSFER_EVENT } from "./abi.js";
import { signClaimToken } from "./eip712.js";

type SigningAccount = ReturnType<typeof privateKeyToAccount>;

/// General-bridging counterpart to withdrawalWatcher.ts's pollWithdrawals:
/// scans a vampchain for wrapped-token transfers to the treasury address —
/// the same "send to treasury" withdrawal signal as native currency, just
/// as an ERC20 Transfer event instead of a plain value transfer — and signs
/// an EIP-712 ClaimToken for each one. Only scans tokens this chain has
/// actually had general-bridged at least once (WrappedToken rows); does
/// nothing for a chain with none, which is the common case.
export async function pollGeneralWithdrawals(
  chain: ChainRow,
  signingAccount: SigningAccount,
  l1ChainId: number,
  bridgeAddress: Address,
  treasuryAddress: Address
) {
  if (!chain.rpcUrl) return;

  const wrappedTokens = await prisma.wrappedToken.findMany({ where: { chainDbId: chain.id } });
  if (wrappedTokens.length === 0) return;

  const sideClient = createPublicClient({ transport: http(chain.rpcUrl) });

  const cursorId = `sidechain-token-burns-${chain.chainId}`;
  const cursor = await prisma.indexerCursor.upsert({
    where: { id: cursorId },
    update: {},
    create: { id: cursorId, lastBlock: 0n },
  });

  const safeLatest = await sideClient.getBlockNumber();
  const fromBlock = cursor.lastBlock + 1n;
  if (fromBlock > safeLatest) return;

  const logs = await sideClient.getLogs({
    address: wrappedTokens.map((w) => w.wrapped as Address),
    event: TRANSFER_EVENT,
    args: { to: treasuryAddress },
    fromBlock,
    toBlock: safeLatest,
  });

  const wrappedByAddress = new Map(wrappedTokens.map((w) => [w.wrapped.toLowerCase(), w]));

  for (const log of logs) {
    const wrappedRow = wrappedByAddress.get(log.address.toLowerCase());
    if (!wrappedRow) continue; // shouldn't happen, address list came from wrappedTokens itself
    const { from, amount } = log.args;
    if (!from || amount === undefined || !log.transactionHash || log.blockNumber === null) continue;

    await handleGeneralBurn(
      chain,
      wrappedRow.l1Token as Address,
      log.transactionHash,
      from,
      amount,
      log.blockNumber,
      signingAccount,
      l1ChainId,
      bridgeAddress
    );
  }

  await prisma.indexerCursor.update({ where: { id: cursorId }, data: { lastBlock: safeLatest } });
}

async function handleGeneralBurn(
  chain: ChainRow,
  token: Address,
  sidechainTxHash: `0x${string}`,
  to: Address,
  amount: bigint,
  sidechainBlock: bigint,
  signingAccount: SigningAccount,
  l1ChainId: number,
  bridgeAddress: Address
) {
  const existing = await prisma.withdrawalEvent.findUnique({ where: { sidechainTxHash } });
  if (existing?.signature) return;

  if (amount === 0n) return;

  const signature = await signClaimToken(signingAccount, {
    l1ChainId,
    bridgeAddress,
    claim: { vampChainId: chain.chainId, token, to, amount, sidechainTxHash },
  });

  await prisma.withdrawalEvent.upsert({
    where: { sidechainTxHash },
    update: { signature },
    create: {
      chainDbId: chain.id,
      chainId: chain.chainId,
      sidechainTxHash,
      sidechainBlock,
      to,
      amount: amount.toString(),
      token,
      signature,
    },
  });

  console.log(
    `[general-withdrawals] signed claim for ${amount} raw units of ${token} to ${to} on chain ${chain.chainId} (sidechain tx ${sidechainTxHash})`
  );
}
