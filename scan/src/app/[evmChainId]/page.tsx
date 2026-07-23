import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@vampchains/db";
import { StatusPill } from "@/components/StatusPill";
import { LiveBlockList } from "@/components/LiveBlockList";
import { AddressLink } from "@/components/AddressLink";
import { EXPLORER_STATUS_COPY, isLiveStatus } from "@/lib/statusCopy";

export const dynamic = "force-dynamic";

export default async function ChainOverviewPage({ params }: { params: Promise<{ evmChainId: string }> }) {
  const { evmChainId: evmChainIdParam } = await params;

  let evmChainId: bigint;
  try {
    evmChainId = BigInt(evmChainIdParam);
  } catch {
    notFound();
  }

  const chain = await prisma.chain.findUnique({ where: { evmChainId } });
  if (!chain) notFound();

  const live = isLiveStatus(chain.status);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-5 py-14">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-blood">
            evmChainId {chain.evmChainId.toString()}
          </p>
          <h1 className="text-display mt-1.5 text-4xl text-bone">{chain.name}</h1>
          <p className="mt-2 text-sm text-bone-dim/60">
            <span className="font-mono text-bone-dim">${chain.symbol}</span> · base token{" "}
            <AddressLink evmChainId={evmChainIdParam} address={chain.baseToken} />
            {" · created by "}
            <AddressLink evmChainId={evmChainIdParam} address={chain.creator} />
          </p>
        </div>
        <StatusPill status={chain.status} />
      </div>

      <div className="flex gap-4 text-xs">
        <Link href={`/${evmChainIdParam}/contracts`} className="text-bone-dim/60 hover:text-blood-bright">
          Verified contracts →
        </Link>
        <Link href={`/${evmChainIdParam}/verify`} className="text-bone-dim/60 hover:text-blood-bright">
          Verify a contract →
        </Link>
      </div>

      {live ? (
        <section className="rounded-2xl border border-hairline bg-ink-raised p-6">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-blood">Live</p>
          <h2 className="text-display mt-1.5 text-xl text-bone">Latest blocks</h2>
          <div className="mt-5">
            <LiveBlockList evmChainId={evmChainIdParam} />
          </div>
        </section>
      ) : (
        (() => {
          const copy = EXPLORER_STATUS_COPY[chain.status];
          if (!copy) return null;
          return (
            <div className={`rounded-2xl border px-6 py-10 text-center text-sm ${copy.tone}`}>
              <p className="text-display text-lg">{copy.title}</p>
              <p className="mx-auto mt-2 max-w-md leading-relaxed opacity-90">{copy.body}</p>
            </div>
          );
        })()
      )}
    </div>
  );
}
