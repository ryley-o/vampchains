import type { Address, PublicClient } from "viem";
import { prisma } from "@vampchains/db";
import { CHAIN_CREATED_EVENT, ERC20_METADATA_ABI } from "./abi.js";
import { getLogsChunked } from "./chunkedGetLogs.js";

const CURSOR_ID = "registry-chains";

/// Vampchain EVM chain ids are derived deterministically from the registry
/// chainId so the provisioner never needs a separate counter to track.
const EVM_CHAIN_ID_OFFSET = 900_000n;
export function deriveEvmChainId(registryChainId: bigint): bigint {
  return EVM_CHAIN_ID_OFFSET + registryChainId;
}

/// Scans for new VampChainRegistry.ChainCreated events and queues each one
/// for provisioning (PENDING_PROVISION row in Postgres). Idempotent: a chain
/// already present in the DB is left untouched regardless of its status.
export async function pollNewChains(l1Client: PublicClient, registryAddress: Address, confirmations: number) {
  const latest = await l1Client.getBlockNumber();
  const safeLatest = latest > BigInt(confirmations) ? latest - BigInt(confirmations) : 0n;

  // On a fresh deployment against a live chain (not a brand-new local dev
  // chain), there's no reason to scan from block 1 — that's potentially
  // millions of blocks of history we don't care about. Start from "now".
  const cursor = await prisma.indexerCursor.upsert({
    where: { id: CURSOR_ID },
    update: {},
    create: { id: CURSOR_ID, lastBlock: safeLatest > 0n ? safeLatest - 1n : 0n },
  });

  const fromBlock = cursor.lastBlock + 1n;
  if (fromBlock > safeLatest) return;

  const logs = await getLogsChunked(l1Client, {
    address: registryAddress,
    event: CHAIN_CREATED_EVENT,
    fromBlock,
    toBlock: safeLatest,
  });

  for (const log of logs) {
    const { chainId, baseToken, creator, name, symbol } = log.args;
    if (chainId === undefined || !baseToken || !creator || name === undefined || symbol === undefined) continue;

    const existing = await prisma.chain.findUnique({ where: { chainId } });
    if (existing) continue;

    const { tokenName, tokenSymbol, decimals } = await readTokenMetadata(l1Client, baseToken);

    await prisma.chain.create({
      data: {
        chainId,
        evmChainId: deriveEvmChainId(chainId),
        baseToken,
        baseTokenName: tokenName,
        baseTokenSymbol: tokenSymbol,
        baseTokenDecimals: decimals,
        name,
        symbol,
        creator,
        status: "PENDING_PROVISION",
      },
    });
    console.log(`[chains] discovered new chain ${chainId} (${name}/${symbol}), queued for provisioning`);
  }

  await prisma.indexerCursor.update({ where: { id: CURSOR_ID }, data: { lastBlock: safeLatest } });
}

async function readTokenMetadata(l1Client: PublicClient, baseToken: Address) {
  const [tokenName, tokenSymbol, decimals] = await Promise.all([
    l1Client
      .readContract({ address: baseToken, abi: ERC20_METADATA_ABI, functionName: "name" })
      .catch(() => "Unknown Token"),
    l1Client.readContract({ address: baseToken, abi: ERC20_METADATA_ABI, functionName: "symbol" }).catch(() => "???"),
    // VampChainRegistry.createChain already probes decimals() and reverts if
    // missing, so this should never actually throw for a real chain.
    l1Client.readContract({ address: baseToken, abi: ERC20_METADATA_ABI, functionName: "decimals" }),
  ]);
  return { tokenName, tokenSymbol, decimals };
}
