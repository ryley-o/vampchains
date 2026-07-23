import type { Address, PublicClient } from "viem";
import { Prisma, prisma } from "@vampchains/db";
import { CHAIN_CREATED_EVENT, ERC20_METADATA_ABI } from "./abi.js";
import { getLogsChunked } from "./chunkedGetLogs.js";
import { generateEvmChainIdCandidate } from "./evmChainId.js";

/// Every attempt draws a fresh random candidate (see evmChainId.ts for why
/// random beats a predictable sequential scheme) and relies on
/// `Chain.evmChainId`'s DB-level unique constraint to make internal
/// collision impossible, not just unlikely — a conflicting insert throws
/// Prisma's P2002 and just gets retried with a new draw. At this range
/// (~2.1 billion candidates) a real collision is astronomically rare; this
/// loop exists to make that a guarantee rather than a statistic.
const MAX_EVM_CHAIN_ID_ATTEMPTS = 10;

/// Scans one home chain's VampChainRegistry for new ChainCreated events and
/// queues each one for provisioning (PENDING_PROVISION row in Postgres).
/// Idempotent: a chain already present in the DB (matched by
/// `[homeChainId, chainId]`, *not* bare `chainId` — see the Chain model's
/// docstring for why that's never unique on its own) is left untouched
/// regardless of its status. Cursor id includes the registry address, not
/// just homeChainId — a registry redeploy (new contract, same home chain)
/// must never resume from the old contract's block height, since blocks on
/// the home chain keep advancing regardless of which contract we're
/// watching. Without this, a redeploy silently misses every ChainCreated
/// event between the old cursor's block and the new contract's own
/// deployment block, forever (caught live this session: a chain created
/// right after a registry redeploy sat un-provisioned indefinitely until
/// the stale cursor was found and manually reset).
export async function pollNewChains(
  l1Client: PublicClient,
  homeChainId: number,
  registryAddress: Address,
  confirmations: number
) {
  const cursorId = `registry-chains-${homeChainId}-${registryAddress.toLowerCase()}`;
  const latest = await l1Client.getBlockNumber();
  const safeLatest = latest > BigInt(confirmations) ? latest - BigInt(confirmations) : 0n;

  // On a fresh deployment against a live chain (not a brand-new local dev
  // chain), there's no reason to scan from block 1 — that's potentially
  // millions of blocks of history we don't care about. Start from "now".
  const cursor = await prisma.indexerCursor.upsert({
    where: { id: cursorId },
    update: {},
    create: { id: cursorId, lastBlock: safeLatest > 0n ? safeLatest - 1n : 0n },
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

    const existing = await prisma.chain.findUnique({ where: { homeChainId_chainId: { homeChainId, chainId } } });
    if (existing) continue;

    const { tokenName, tokenSymbol, decimals } = await readTokenMetadata(l1Client, baseToken);

    const evmChainId = await createChainWithFreshEvmChainId({
      homeChainId,
      chainId,
      baseToken,
      baseTokenName: tokenName,
      baseTokenSymbol: tokenSymbol,
      baseTokenDecimals: decimals,
      name,
      symbol,
      creator,
    });
    console.log(
      `[chains] discovered new chain ${chainId} on home chain ${homeChainId} (${name}/${symbol}), assigned evmChainId ${evmChainId}, queued for provisioning`
    );
  }

  await prisma.indexerCursor.update({ where: { id: cursorId }, data: { lastBlock: safeLatest } });
}

interface NewChainData {
  homeChainId: number;
  chainId: bigint;
  baseToken: Address;
  baseTokenName: string;
  baseTokenSymbol: string;
  baseTokenDecimals: number;
  name: string;
  symbol: string;
  creator: Address;
}

/// Creates the Chain row with a freshly-generated random evmChainId,
/// retrying with a new draw on the vanishingly rare event of a P2002
/// unique-constraint conflict — see the module-level comment above and
/// evmChainId.ts for why this is random rather than derived from
/// `chainId` directly.
async function createChainWithFreshEvmChainId(data: NewChainData): Promise<bigint> {
  for (let attempt = 1; attempt <= MAX_EVM_CHAIN_ID_ATTEMPTS; attempt++) {
    const evmChainId = generateEvmChainIdCandidate();
    try {
      await prisma.chain.create({ data: { ...data, evmChainId, status: "PENDING_PROVISION" } });
      return evmChainId;
    } catch (err) {
      const isEvmChainIdConflict =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002" &&
        (err.meta?.target as string[] | undefined)?.includes("evmChainId");
      if (!isEvmChainIdConflict) throw err;
      console.warn(`[chains] evmChainId ${evmChainId} collided on attempt ${attempt}, drawing again`);
    }
  }
  throw new Error(`failed to find a free evmChainId after ${MAX_EVM_CHAIN_ID_ATTEMPTS} attempts`);
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
