import Link from "next/link";
import { FangDivider } from "@/components/brand/FangDivider";

export const dynamic = "force-static";

function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section className="py-14 sm:py-16">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-blood">{eyebrow}</p>
      <h2 className="text-display mt-2 text-3xl text-bone sm:text-4xl">{title}</h2>
      <div className="mt-6 space-y-4 text-sm leading-relaxed text-bone-dim/80 sm:text-base">{children}</div>
    </section>
  );
}

function Dot({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${className}`} />;
}

function TwoRevenueStreamsDiagram() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="rounded-2xl border border-hairline bg-ink-raised p-5 sm:p-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-emerald-300">Tips</p>
        <div className="relative mt-4 h-1 rounded-full bg-charcoal-soft">
          <span className="absolute -top-[3px] h-2 w-2 animate-flow rounded-full bg-emerald-300" />
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-bone-dim/60">
          <span>Every transaction</span>
          <span>Pools at the chain&apos;s wallet</span>
        </div>
        <p className="mt-4 text-sm text-bone-dim/70">
          A small tip on top of every transaction accrues as real balance. Every so often it&apos;s
          swept out and becomes claimable.
        </p>
      </div>

      <div className="rounded-2xl border border-hairline bg-ink-raised p-5 sm:p-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-blood-bright">Base fee</p>
        <div className="mt-4 flex items-center justify-center">
          <span
            className="animate-flicker text-2xl"
            role="img"
            aria-label="flame"
          >
            🔥
          </span>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-bone-dim/60">
          <span>Every transaction</span>
          <span>Destroyed, not pooled</span>
        </div>
        <p className="mt-4 text-sm text-bone-dim/70">
          The rest of the gas fee is destroyed outright — standard Ethereum rules. Nothing sits
          anywhere to sweep, but we keep an exact running count of it, and that count is what
          becomes claimable.
        </p>
      </div>
    </div>
  );
}

function SplitDiagram() {
  const bars = [
    { label: "Creator", color: "bg-emerald-300", delay: "0s" },
    { label: "Protocol", color: "bg-bone-dim", delay: "0.15s" },
    { label: "Runway", color: "bg-blood-bright", delay: "0.3s" },
  ];
  return (
    <div className="rounded-2xl border border-hairline bg-ink-raised p-5 sm:p-6">
      <div className="grid grid-cols-3 gap-4">
        {bars.map((bar) => (
          <div key={bar.label}>
            <div className="h-24 overflow-hidden rounded-lg bg-charcoal-soft">
              <div
                className={`animate-grow-x h-full w-full ${bar.color}`}
                style={{ animationDelay: bar.delay }}
              />
            </div>
            <p className="mt-2 text-center text-xs text-bone-dim/60">{bar.label}</p>
          </div>
        ))}
      </div>
      <p className="mt-5 text-center text-xs text-bone-dim/50">
        Every claim splits into three equal shares. Any leftover wei from rounding (0–2 of them)
        tops off the runway share — nobody else is ever shorted.
      </p>
    </div>
  );
}

function TimelineDiagram() {
  return (
    <div className="space-y-6 rounded-2xl border border-hairline bg-ink-raised p-5 sm:p-6">
      <div>
        <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-emerald-300">
          <Dot className="bg-emerald-300" /> Tips
        </p>
        <div className="relative mt-4 h-px bg-hairline-strong">
          <span className="absolute left-[15%] top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-emerald-300/60" />
          <span className="absolute left-[45%] top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-emerald-300/60" />
          <span className="absolute left-[75%] top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-emerald-300/60" />
          <span className="animate-marker-pulse absolute right-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-blood" />
        </div>
        <p className="mt-2 text-xs text-bone-dim/50">
          Accrues continuously, swept roughly every 24 hours (each sweep, its own claimable
          signature) → claimable any time after.
        </p>
      </div>

      <div>
        <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-blood-bright">
          <Dot className="bg-blood-bright" /> Base fee
        </p>
        <div className="relative mt-4 h-1 overflow-hidden rounded-full bg-charcoal-soft">
          <div className="animate-grow-x h-full w-full bg-blood-bright/70" style={{ animationDuration: "3.5s" }} />
        </div>
        <p className="mt-2 text-xs text-bone-dim/50">
          Burns continuously, running total re-signed whenever it grows (one signature, always the
          latest) → claimable any time.
        </p>
      </div>
    </div>
  );
}

export default function HowFeesWorkPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-14 sm:py-16">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-blood">The mechanics</p>
      <h1 className="text-display mt-2 text-4xl text-bone sm:text-5xl">How fees actually work</h1>
      <p className="mt-4 max-w-xl text-base text-bone-dim/70">
        Every transaction on a vampchain generates two kinds of real revenue. Here&apos;s where each
        one goes, and when it&apos;s actually claimable.
      </p>

      <FangDivider className="mt-12" />

      <Section eyebrow="Two kinds of revenue" title="A tip, and a burn">
        <p>Gas on a vampchain splits into two pieces, and they behave completely differently.</p>
        <TwoRevenueStreamsDiagram />
      </Section>

      <Section eyebrow="Split three ways" title="Every claim pays three parties, automatically">
        <p>
          Whichever kind of revenue it is, once it&apos;s claimed it splits the same way: a third to
          whoever created the chain, a third to the protocol, and a third into a wallet dedicated
          to keeping the chain funded.
        </p>
        <SplitDiagram />
        <p>
          No single address can redirect this or block another party from getting paid — every
          recipient is looked up live from the contract itself, never chosen by whoever submits
          the claim.
        </p>
      </Section>

      <Section eyebrow="Timing" title="When it becomes claimable">
        <TimelineDiagram />
      </Section>

      <Section eyebrow="Who actually does this" title="Public, but not anyone's job">
        <p>
          Claiming is technically open to anyone — nothing about it is gatekept, since the payout
          always lands on the same three fixed addresses no matter who submits it. In practice
          it&apos;s usually the chain&apos;s creator, or a small admin script, pulling revenue in
          whenever it&apos;s worth the gas to do so.
        </p>
      </Section>

      <FangDivider className="mb-10" />

      <div className="flex flex-wrap items-center justify-center gap-4 pb-4 text-center">
        <Link
          href="/how-it-works"
          className="rounded-full bg-blood px-7 py-3.5 text-sm font-semibold uppercase tracking-wider text-bone shadow-[0_0_40px_rgba(226,45,58,0.35)] transition-all hover:scale-105 hover:bg-blood-bright active:scale-95"
        >
          Back to how it works
        </Link>
        <Link
          href="/create"
          className="rounded-full border border-hairline-strong px-7 py-3.5 text-sm font-semibold text-bone-dim transition-colors hover:border-bone-dim hover:text-bone"
        >
          Create your chain
        </Link>
      </div>
    </div>
  );
}
