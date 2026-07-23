import Link from "next/link";
import { prisma } from "@vampchains/db";
import { StatusPill } from "@/components/StatusPill";
import { shortAddress } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;

  const chains = await prisma.chain.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { symbol: { contains: q, mode: "insensitive" } },
            { creator: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-6xl px-5 py-14">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-blood">Every vampchain</p>
      <h1 className="text-display mt-2 text-4xl text-bone sm:text-5xl">Vampscan</h1>
      <p className="mt-3 max-w-xl text-sm text-bone-dim/70">
        A block explorer covering every vampchain that&apos;s ever existed — read live from each
        chain&apos;s own node, no separate indexer.
      </p>

      {q && (
        <p className="mt-6 text-sm text-bone-dim/50">
          {chains.length}
          {" "}
          result{chains.length === 1 ? "" : "s"}
          {" "}
          for <span className="text-bone">&quot;{q}&quot;</span>
        </p>
      )}

      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {chains.map((chain) => (
          <Link
            key={chain.id}
            href={`/${chain.evmChainId}`}
            className="rounded-2xl border border-hairline bg-ink-raised p-5 transition-colors hover:border-blood/50"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-display text-lg text-bone">{chain.name}</p>
                <p className="mt-0.5 font-mono text-xs uppercase tracking-wider text-blood">${chain.symbol}</p>
              </div>
              <StatusPill status={chain.status} />
            </div>
            <p className="mt-3 truncate font-mono text-[11px] text-bone-dim/40">
              evmChainId {chain.evmChainId.toString()} · created by {shortAddress(chain.creator)}
            </p>
          </Link>
        ))}
        {chains.length === 0 && <p className="text-sm text-bone-dim/50">No chains found.</p>}
      </div>
    </div>
  );
}
