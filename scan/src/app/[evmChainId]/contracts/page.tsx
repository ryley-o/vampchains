import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@vampchains/db";
import { AddressLink } from "@/components/AddressLink";

export const dynamic = "force-dynamic";

export default async function ContractsPage({ params }: { params: Promise<{ evmChainId: string }> }) {
  const { evmChainId: evmChainIdParam } = await params;

  let evmChainId: bigint;
  try {
    evmChainId = BigInt(evmChainIdParam);
  } catch {
    notFound();
  }

  const chain = await prisma.chain.findUnique({ where: { evmChainId } });
  if (!chain) notFound();

  const contracts = await prisma.verifiedContract.findMany({
    where: { chainDbId: chain.id },
    orderBy: { verifiedAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-5 py-14">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={`/${evmChainIdParam}`} className="text-xs text-bone-dim/50 hover:text-bone-dim">
            ← {chain.name}
          </Link>
          <h1 className="text-display mt-1.5 text-2xl text-bone sm:text-3xl">Verified contracts</h1>
        </div>
        <Link
          href={`/${evmChainIdParam}/verify`}
          className="rounded-full border border-blood/60 px-4 py-2 text-xs font-medium text-blood-bright hover:bg-blood/10"
        >
          Verify a contract →
        </Link>
      </div>

      {contracts.length === 0 ? (
        <p className="text-sm text-bone-dim/50">
          No community-submitted verified contracts on this chain yet. The two genesis contracts
          (VampWrappedTokenFactory / VampWrappedToken implementation) and every wrapped-token clone are
          always shown as verified on their own address pages — those don&apos;t need submission, they&apos;re
          the same bytecode on every vampchain.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-hairline bg-ink-raised">
          <table className="w-full text-left text-sm">
            <thead className="font-mono text-[11px] uppercase tracking-wider text-bone-dim/40">
              <tr>
                <th className="px-6 py-3 font-normal">Address</th>
                <th className="px-6 py-3 font-normal">Contract</th>
                <th className="px-6 py-3 font-normal">Compiler</th>
                <th className="px-6 py-3 font-normal">Match</th>
                <th className="px-6 py-3 font-normal">Verified</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id} className="border-t border-hairline">
                  <td className="px-6 py-3">
                    <AddressLink evmChainId={evmChainIdParam} address={c.address} />
                  </td>
                  <td className="px-6 py-3 text-bone">{c.contractName}</td>
                  <td className="px-6 py-3 font-mono text-xs text-bone-dim/70">{c.compilerVersion}</td>
                  <td className="px-6 py-3">
                    <span
                      className={`font-mono text-xs uppercase ${c.matchType === "full" ? "text-emerald-300" : "text-amber-300"}`}
                    >
                      {c.matchType}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-xs text-bone-dim/50">{c.verifiedAt.toISOString().slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
