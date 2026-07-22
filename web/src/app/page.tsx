import Link from "next/link";
import { prisma } from "@vampchains/db";
import { getRemainingRuntime } from "@/lib/registryReads";
import { shortAddress } from "@/lib/format";
import { CONTRACTS_CONFIGURED, L1_CHAIN_ID } from "@/lib/contracts";
import { StatusPill } from "@/components/StatusPill";
import { TokenLogo } from "@/components/TokenLogo";
import { CinematicIntro } from "@/components/brand/CinematicIntro";
import { FangDivider } from "@/components/brand/FangDivider";
import { RunwayMeter } from "@/components/brand/RunwayMeter";
import { Logo } from "@/components/brand/Logo";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    n: "01",
    title: "Pick a token",
    body: "Any ERC20 on Base already qualifies. Yours, a friend's, that coin you found on a dead Telegram at 3am.",
  },
  {
    n: "02",
    title: "Pay the fee",
    body: "One annual fee in USDC, drawn down linearly. Nobody can charge you for runway you haven't used yet.",
  },
  {
    n: "03",
    title: "It's alive",
    body: "A single-node EVM chain spins up in seconds, running on your token as native gas. Bridge in, go build.",
  },
];

export default async function HomePage() {
  const chains = await prisma.chain.findMany({ orderBy: { createdAt: "desc" } });

  const withRuntime = await Promise.all(
    chains.map(async (chain) => ({
      chain,
      remainingRuntime: await getRemainingRuntime(chain.chainId),
    }))
  );

  return (
    <>
      <CinematicIntro />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-hairline">
        <div className="pattern-drift pointer-events-none absolute inset-0 opacity-[0.15]" />
        <div className="relative mx-auto max-w-6xl px-5 py-24 sm:py-32">
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-blood">
            <Logo className="h-4 w-4" />
            Base Sepolia · live
          </div>
          <h1 className="text-display mt-5 max-w-3xl text-5xl text-bone sm:text-7xl">
            Pick a token.
            <br />
            <span className="text-glow text-blood">Get a chain.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-bone-dim/80">
            Any existing ERC20 can become the native gas of its own single-node EVM sidechain.
            Bridge it in, and you&apos;ve got a whole little universe running on your token.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link
              href="/create"
              className="rounded-full bg-blood px-7 py-3.5 text-sm font-semibold uppercase tracking-wider text-bone shadow-[0_0_40px_rgba(226,45,58,0.35)] transition-all hover:scale-105 hover:bg-blood-bright active:scale-95"
            >
              Create your chain
            </Link>
            <a
              href="#chains"
              className="rounded-full border border-hairline-strong px-7 py-3.5 text-sm font-semibold text-bone-dim transition-colors hover:border-bone-dim hover:text-bone"
            >
              Explore chains
            </a>
          </div>
        </div>
      </section>

      {!CONTRACTS_CONFIGURED && (
        <div className="mx-auto max-w-6xl px-5 pt-8">
          <p className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
            Contracts aren&apos;t configured yet (<code>NEXT_PUBLIC_REGISTRY_ADDRESS</code> is
            unset) — funding data won&apos;t load until env vars are set. See
            docs/DEPLOYMENT.md.
          </p>
        </div>
      )}

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <FangDivider className="mb-14" />
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.n}>
              <span className="font-mono text-sm text-blood">{step.n}</span>
              <h3 className="text-display mt-2 text-xl text-bone">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-bone-dim/70">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Live chains */}
      <section id="chains" className="scroll-mt-20 border-t border-hairline">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="flex items-end justify-between">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-blood">The colony</p>
              <h2 className="text-display mt-2 text-3xl text-bone">Live vampchains</h2>
            </div>
            <Link
              href="/create"
              className="hidden text-sm font-semibold text-blood transition-colors hover:text-blood-bright sm:inline"
            >
              + spawn one
            </Link>
          </div>

          {chains.length === 0 ? (
            <div className="mt-12 rounded-2xl border border-dashed border-hairline-strong px-6 py-16 text-center">
              <p className="text-lg font-medium text-bone-dim">No chains yet. The night is young.</p>
              <p className="mt-2 text-sm text-bone-dim/50">
                Be the first vampire to give a token its own universe.
              </p>
              <Link
                href="/create"
                className="mt-6 inline-block rounded-full bg-blood px-6 py-2.5 text-sm font-semibold uppercase tracking-wider text-bone transition-colors hover:bg-blood-bright"
              >
                Create the first chain
              </Link>
            </div>
          ) : (
            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {withRuntime.map(({ chain, remainingRuntime }) => (
                <Link
                  key={chain.id}
                  href={`/chains/${chain.chainId}`}
                  className="group relative overflow-hidden rounded-2xl border border-hairline bg-ink-raised p-5 transition-all hover:-translate-y-1 hover:border-blood/50 hover:shadow-[0_8px_40px_rgba(226,45,58,0.15)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <TokenLogo address={chain.baseToken} chainId={L1_CHAIN_ID} size={36} />
                      <div className="min-w-0">
                        <p className="truncate text-display text-lg text-bone">{chain.name}</p>
                        <p className="mt-0.5 font-mono text-xs uppercase tracking-wider text-blood">
                          ${chain.symbol}
                        </p>
                      </div>
                    </div>
                    <StatusPill status={chain.status} />
                  </div>
                  <p className="mt-3 truncate font-mono text-[11px] text-bone-dim/40">
                    {shortAddress(chain.baseToken)}
                  </p>
                  <div className="mt-5">
                    <RunwayMeter remainingRuntime={remainingRuntime} active={chain.status === "ACTIVE"} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
