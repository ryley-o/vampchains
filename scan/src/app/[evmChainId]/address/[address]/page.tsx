import { notFound } from "next/navigation";
import Link from "next/link";
import { isAddress } from "viem";
import { prisma } from "@vampchains/db";
import { ChainGate } from "@/components/ChainGate";
import { LiveAddressDetail } from "@/components/LiveAddressDetail";

export const dynamic = "force-dynamic";

export default async function AddressDetailPage({
  params,
}: {
  params: Promise<{ evmChainId: string; address: string }>;
}) {
  const { evmChainId, address } = await params;

  if (!isAddress(address)) notFound();

  const chain = await prisma.chain.findUnique({ where: { evmChainId: BigInt(evmChainId) } });
  if (!chain) notFound();

  // WrappedToken lookups (and, later, VerifiedContract) are always
  // compound-keyed by chainDbId + address, never bare address — the same
  // L1 token bridged into two different vampchains gets the identical
  // wrapped-clone address on both (see contracts/src/VampWrappedTokenFactory.sol).
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
          verifiedContract={
            verifiedContract
              ? {
                  contractName: verifiedContract.contractName,
                  compilerVersion: verifiedContract.compilerVersion,
                  matchType: verifiedContract.matchType,
                  abi: verifiedContract.abi as unknown[],
                }
              : null
          }
        />
      </ChainGate>
    </div>
  );
}
