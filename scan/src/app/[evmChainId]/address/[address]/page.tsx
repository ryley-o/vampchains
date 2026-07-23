import { notFound } from "next/navigation";
import Link from "next/link";
import { getAddress, isAddress } from "viem";
import { prisma } from "@vampchains/db";
import { ChainGate } from "@/components/ChainGate";
import { LiveAddressDetail } from "@/components/LiveAddressDetail";
import { GATEWAY_URL } from "@/lib/gatewayClient";
import { extractSources } from "@/lib/standardJsonInput";

export const dynamic = "force-dynamic";

export default async function AddressDetailPage({
  params,
}: {
  params: Promise<{ evmChainId: string; address: string }>;
}) {
  const { evmChainId, address: addressParam } = await params;

  if (!isAddress(addressParam)) notFound();
  // Every compound-key lookup below (WrappedToken/VerifiedContract/TxActivity)
  // stores addresses checksummed via viem's getAddress() at write time — a
  // URL typed or pasted in a different case would otherwise silently miss
  // an exact Postgres string match (confirmed live: this exact mismatch
  // hid real TxActivity rows before this normalization was added).
  const address = getAddress(addressParam);

  const chain = await prisma.chain.findUnique({ where: { evmChainId: BigInt(evmChainId) } });
  if (!chain) notFound();

  // WrappedToken lookups (and VerifiedContract) are always compound-keyed
  // by chainDbId + address, never bare address — the same L1 token bridged
  // into two different vampchains gets the identical wrapped-clone address
  // on both (see contracts/src/VampWrappedTokenFactory.sol).
  const wrappedToken = await prisma.wrappedToken.findUnique({
    where: { chainDbId_l1Token: { chainDbId: chain.id, l1Token: address } },
  }).catch(() => null);
  const wrappedByAddress = await prisma.wrappedToken.findFirst({
    where: { chainDbId: chain.id, wrapped: address },
  });

  // Only reachable when the client-side genesis/EIP-1167 recognition
  // (contractRecognition.ts) comes back "unrecognized" — this is the one
  // case that needs a real DB round-trip, compound-keyed by (chainDbId,
  // address) for the same salt-collision reason as WrappedToken above.
  const verifiedContract = await prisma.verifiedContract.findUnique({
    where: { chainDbId_address: { chainDbId: chain.id, address } },
  });

  // Native-currency transfer history has no RPC equivalent (vanilla geth
  // has no "all txs by address" method) — this is the one thing on this
  // page that comes from Postgres rather than a live RPC call, populated
  // by infra/relayer's gasContributionWatcher. Only covers activity from
  // whenever that watcher started running forward, never a full history.
  const txActivity = await prisma.txActivity.findMany({
    where: { chainDbId: chain.id, OR: [{ from: address }, { to: address }] },
    orderBy: { blockNumber: "desc" },
    take: 25,
  });

  // A contract's creation tx has no RPC-level lookup either (same reason
  // as native tx history above) — answered from the same TxActivity table,
  // populated by the same watcher.
  const creationTx = await prisma.txActivity.findFirst({
    where: { chainDbId: chain.id, contractAddress: address },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-5 py-14">
      <div>
        <Link href={`/${evmChainId}`} className="text-xs text-bone-dim/50 hover:text-bone-dim">
          ← {chain.name}
        </Link>
        <h1 className="text-display mt-1.5 break-all text-2xl text-bone sm:text-3xl">Address</h1>
        <p className="mt-1 break-all font-mono text-sm text-bone-dim/50">{address}</p>
      </div>

      <ChainGate status={chain.status}>
        <LiveAddressDetail
          evmChainId={evmChainId}
          address={address as `0x${string}`}
          chainSymbol={chain.symbol}
          wrappedTokenMeta={wrappedByAddress ? { name: wrappedByAddress.name, symbol: wrappedByAddress.symbol, decimals: wrappedByAddress.decimals, l1Token: wrappedByAddress.l1Token } : null}
          isKnownL1TokenWrapped={!!wrappedToken}
          txActivity={txActivity.map((t) => ({
            txHash: t.txHash,
            blockNumber: t.blockNumber.toString(),
            from: t.from,
            to: t.to,
            valueNativeWei: t.valueNativeWei,
            status: t.status,
            timestamp: t.timestamp.toISOString(),
          }))}
          verifiedContract={
            verifiedContract
              ? {
                  contractName: verifiedContract.contractName,
                  compilerVersion: verifiedContract.compilerVersion,
                  matchType: verifiedContract.matchType,
                  abi: verifiedContract.abi as unknown[],
                  sources: extractSources(verifiedContract.standardJsonInput),
                }
              : null
          }
          creationTx={creationTx ? { txHash: creationTx.txHash, blockNumber: creationTx.blockNumber.toString() } : null}
          chainName={chain.name}
          gatewayRpcUrl={`${GATEWAY_URL}/rpc/${evmChainId}`}
          homeChainId={chain.homeChainId}
        />
      </ChainGate>
    </div>
  );
}
