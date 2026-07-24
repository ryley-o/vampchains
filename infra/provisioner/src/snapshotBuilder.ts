import type { Address, PublicClient } from "viem";
import { createPublicClient, getAddress, http } from "viem";
import type { privateKeyToAccount } from "viem/accounts";
import type { Chain as ChainRow } from "@vampchains/db";
import { prisma } from "@vampchains/db";
import { TRANSFER_EVENT } from "./abi.js";
import { getLogsChunked } from "./chunkedGetLogs.js";
import { buildSnapshotTree, type SnapshotLeafInput } from "./merkleTree.js";

type SigningAccount = ReturnType<typeof privateKeyToAccount>;

const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000" as Address;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

const SNAPSHOT_TYPES = {
  Snapshot: [
    { name: "vampChainId", type: "uint256" },
    { name: "root", type: "bytes32" },
  ],
} as const;

/// Builds and signs the final-snapshot Merkle root for a chain whose grace
/// period has just expired — see docs/ARCHITECTURE.md "Protocol fee
/// revenue" and VampBridge.sol's `publishSnapshot`/`claimSnapshot`. Called
/// while the vampchain's node is still briefly alive (status
/// AWAITING_SNAPSHOT), reading every real final balance directly off it:
///
/// - Native currency: walks every block looking for plain-value transfers,
///   collecting the set of addresses that ever *received* value (the only
///   ones whose final balance could be nonzero), then reads each one's
///   real final `eth_getBalance`.
/// - Wrapped tokens: for every `WrappedToken` this chain ever general-
///   bridged, scans that token's full Transfer history for unique holders,
///   then reads each one's final `balanceOf`.
///
/// Deliberately excludes `treasuryAddress` and `cliqueSignerAddress` from
/// the snapshot: neither is a user claim. Treasury's balance is working
/// capital that backs future deposit-mints, not money owed to anyone.
/// Whatever the signer address holds is accumulated protocol tip revenue
/// (see docs/ARCHITECTURE.md "Protocol fee revenue") — if it's never
/// claimed before the chain dies, it just becomes part of what
/// `sweepUnclaimed` collects for the protocol once the snapshot's 30-day
/// claim window elapses, exactly like any other unclaimed leaf. No
/// special-casing needed for it here.
///
/// Persists one `SnapshotEntitlement` row per real leaf (so the frontend
/// can look up "does this address have a claim" and fetch its proof, since
/// proofs aren't derivable from a published root alone), then signs
/// `(chainId, root)` with the same key `infra/relayer` uses for withdrawal
/// claims — see config.ts's `relayerPrivateKey` for why sharing it here is
/// a modest, deliberate expansion of an already-accepted trust boundary,
/// not a new one.
export async function buildAndSignSnapshot(
  chain: ChainRow,
  signingAccount: SigningAccount,
  l1ChainId: number,
  bridgeAddress: Address,
  treasuryAddress: Address,
  cliqueSignerAddress: Address
): Promise<{ root: `0x${string}`; signature: `0x${string}` }> {
  if (!chain.rpcUrl) throw new Error(`chain ${chain.chainId} has no rpcUrl, cannot build snapshot`);
  const client = createPublicClient({ transport: http(chain.rpcUrl) });

  const excluded = new Set([treasuryAddress, cliqueSignerAddress].map((a) => a.toLowerCase()));

  const nativeHolders = await collectNativeHolders(client, excluded);
  const nativeLeaves: SnapshotLeafInput[] = [];
  for (const holder of nativeHolders) {
    const balance = await client.getBalance({ address: holder });
    if (balance > 0n) nativeLeaves.push({ token: NATIVE_TOKEN, address: holder, amount: balance });
  }

  const wrappedTokens = await prisma.wrappedToken.findMany({ where: { chainDbId: chain.id } });
  const wrappedLeaves: SnapshotLeafInput[] = [];
  for (const wrapped of wrappedTokens) {
    const holders = await collectTokenHolders(client, getAddress(wrapped.wrapped));
    for (const holder of holders) {
      const balance = (await client.readContract({
        address: getAddress(wrapped.wrapped),
        abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
        functionName: "balanceOf",
        args: [holder],
      })) as bigint;
      if (balance > 0n) {
        wrappedLeaves.push({ token: getAddress(wrapped.l1Token), address: holder, amount: balance });
      }
    }
  }

  const leaves = [...nativeLeaves, ...wrappedLeaves];
  const { root, proofs } = buildSnapshotTree(chain.chainId, leaves);

  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i]!;
    const amount = leaf.amount.toString();
    const proof = JSON.stringify(proofs[i]);

    await prisma.snapshotEntitlement.upsert({
      where: { chainDbId_token_address: { chainDbId: chain.id, token: leaf.token, address: leaf.address } },
      update: { amount, proof },
      create: { chainDbId: chain.id, chainId: chain.chainId, token: leaf.token, address: leaf.address, amount, proof },
    });
  }

  const signature = await signingAccount.signTypedData({
    domain: { name: "VampBridge", version: "1", chainId: l1ChainId, verifyingContract: bridgeAddress },
    types: SNAPSHOT_TYPES,
    primaryType: "Snapshot",
    message: { vampChainId: chain.chainId, root },
  });

  console.log(
    `[snapshot] chain ${chain.chainId}: built ${leaves.length} leaves (${nativeLeaves.length} native, ${wrappedLeaves.length} wrapped), root ${root}`
  );

  return { root, signature };
}

/// Walks every block (there's no ERC20-style Transfer log for native
/// currency to index instead) collecting the set of addresses that ever
/// received a plain value transfer. A single-node Clique chain's full
/// history is expected to be modest for a meme sidechain's traffic level,
/// so a full scan at end-of-life is an acceptable one-time cost — this
/// only ever runs once, right as a chain is being torn down for good.
async function collectNativeHolders(
  client: PublicClient,
  excluded: Set<string>
): Promise<Address[]> {
  const holders = new Set<string>();
  const latest = await client.getBlockNumber();

  for (let blockNumber = 0n; blockNumber <= latest; blockNumber++) {
    const block = await client.getBlock({ blockNumber, includeTransactions: true });
    for (const tx of block.transactions) {
      if (typeof tx === "string") continue;
      if (tx.to && tx.value > 0n) {
        const to = getAddress(tx.to);
        if (!excluded.has(to.toLowerCase())) holders.add(to);
      }
    }
  }

  return Array.from(holders) as Address[];
}

async function collectTokenHolders(client: PublicClient, token: Address): Promise<Address[]> {
  const holders = new Set<string>();
  const latest = await client.getBlockNumber();

  const logs = await getLogsChunked(client, { address: token, event: TRANSFER_EVENT, fromBlock: 0n, toBlock: latest });
  for (const log of logs) {
    const to = log.args.to;
    if (to && to !== ZERO_ADDRESS) holders.add(getAddress(to));
  }

  return Array.from(holders) as Address[];
}
