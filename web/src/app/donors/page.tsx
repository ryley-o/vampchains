import Link from "next/link";
import { prisma } from "@vampchains/db";
import { DonorLookup } from "@/components/DonorLookup";
import { BloodDonorsPanel } from "@/components/BloodDonorsPanel";

export const dynamic = "force-dynamic";

export default async function DonorsPage() {
  const activeChains = await prisma.chain.findMany({
    where: { status: "ACTIVE", rpcUrl: { not: null } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-10 px-5 py-14 sm:py-16">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-blood">The colony</p>
        <h1 className="text-display mt-1.5 text-4xl text-bone sm:text-5xl">Blood given</h1>
        <p className="mt-3 text-sm text-bone-dim/60">
          Every real gas fee a wallet has ever spent on a vampchain, tracked per chain. No payout,
          no claim — just public credit for the people actually keeping these chains alive.
        </p>
      </div>

      <div>
        <h2 className="text-display text-lg text-bone">Look up a wallet</h2>
        <div className="mt-4">
          <DonorLookup />
        </div>
      </div>

      <div className="space-y-6 border-t border-hairline pt-10">
        <h2 className="text-display text-lg text-bone">Top donors, per chain</h2>
        {activeChains.length === 0 ? (
          <p className="text-sm text-bone-dim/50">No active chains yet.</p>
        ) : (
          activeChains.map((chain) => (
            <div key={chain.id}>
              <Link
                href={`/chains/${chain.evmChainId}`}
                className="text-sm font-semibold text-blood transition-colors hover:text-blood-bright"
              >
                {chain.name} <span className="font-mono text-bone-dim/50">(${chain.symbol})</span> →
              </Link>
              <div className="mt-3">
                <BloodDonorsPanel chainDbId={chain.id} symbol={chain.symbol} limit={5} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
