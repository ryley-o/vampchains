import Link from "next/link";
import { prisma } from "@vampchains/db";
import { getRemainingRuntime } from "@/lib/registryReads";
import { shortAddress } from "@/lib/format";
import { CONTRACTS_CONFIGURED, HOME_CHAIN_WEB_CONFIGS } from "@/lib/contracts";
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
    body: "Any ERC20 already qualifies. Yours, a friend's, that coin you found on a dead Telegram at 3am.",
  },
  {
    n: "02",
    title: "Feed it a little blood",
    body: "A small weekly fee keeps the lights on. Burn through it at your own pace, top up whenever — nobody can ever charge you for blood you haven't spent yet.",
  },
  {
    n: "03",
    title: "It's alive",
    body: "A real EVM chain spins up in seconds, running on your token as native gas. Bridge in, go build.",
  },
];

export default async function HomePage() {
  const chains = await prisma.chain.findMany({ orderBy: { createdAt: "desc" } });

  const withRuntime = await Promise.all(
    chains.map(async (chain) => ({
      chain,
      remainingRuntime: await getRemainingRuntime(chain.homeChainId, chain.chainId),
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
            {HOME_CHAIN_WEB_CONFIGS.map((c) => c.name).join(" · ")} · live
          </div>
          <h1 className="text-display mt-5 max-w-3xl text-5xl text-bone sm:text-7xl">
            Pick a token.
            <br />
            <span className="text-glow text-blood">Give it fangs.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-bone-dim/80">
            Any ERC20 can become the native gas of its own real chain. Bridge it in, and
            you&apos;ve got a whole little universe running on your token.
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
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2">
            <p className="flex items-center gap-2 text-xs text-bone-dim/60">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
              <span>
                Creators keep <span className="font-semibold text-emerald-300">1/3 of every gas fee</span>, forever
              </span>
            </p>
            <p className="flex items-center gap-2 text-xs text-bone-dim/60">
              <span className="h-1.5 w-1.5 shrink-0 animate-heartbeat rounded-full bg-blood" />
              <span>
                Every transaction{" "}
                <span className="font-semibold text-blood-bright">extends its chain&apos;s runway</span>
              </span>
            </p>
          </div>
        </div>
      </section>

      {!CONTRACTS_CONFIGURED && (
        <div className="mx-auto max-w-6xl px-5 pt-8">
          <p className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
            No home chain is configured yet (e.g. <code>NEXT_PUBLIC_BASE_REGISTRY_ADDRESS</code>
            is unset) — funding data won&apos;t load until at least one is set. See
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
        <p className="mt-10 text-sm text-bone-dim/50">
          You also earn from it, forever — and yes, there&apos;s an honest answer for what
          happens if the blood ever runs dry.{" "}
          <Link href="/how-it-works" className="text-blood underline underline-offset-2 hover:text-blood-bright">
            See how it all works →
          </Link>
        </p>
      </section>

      {/* Creator incentives teaser */}
      <section className="border-t border-hairline bg-ink-raised/40">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 sm:items-center">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-blood">
                Creator incentives
              </p>
              <h2 className="text-display mt-2 text-3xl text-bone">
                You don&apos;t just pay for a chain. You earn from it.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-bone-dim/70">
                Every transaction on your vampchain generates gas fees. We split that revenue
                three ways — you, the protocol, and a third that goes straight back into keeping
                your chain funded — automatically, for as long as the chain runs, on top of
                whatever the token itself is worth.
              </p>
              <Link
                href="/how-it-works"
                className="mt-5 inline-block text-sm font-semibold text-blood transition-colors hover:text-blood-bright"
              >
                See the worked example →
              </Link>
            </div>
            <div className="rounded-2xl border border-hairline bg-ink p-6">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-bone-dim/40">
                Example month
              </p>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-sm text-bone-dim/60">Chain generates</span>
                <span className="font-mono text-lg text-bone">$90</span>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-hairline pt-3">
                <span className="text-sm text-bone-dim/60">You (creator)</span>
                <span className="font-mono text-lg text-emerald-300">$30</span>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm text-bone-dim/60">Protocol</span>
                <span className="font-mono text-lg text-bone-dim">$30</span>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm text-bone-dim/60">Chain runway</span>
                <span className="font-mono text-lg text-blood-bright">$30</span>
              </div>
            </div>
          </div>
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
                  href={`/chains/${chain.evmChainId}`}
                  className="group relative overflow-hidden rounded-2xl border border-hairline bg-ink-raised p-5 transition-all hover:-translate-y-1 hover:border-blood/50 hover:shadow-[0_8px_40px_rgba(226,45,58,0.15)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <TokenLogo address={chain.baseToken} chainId={chain.homeChainId} size={36} />
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
