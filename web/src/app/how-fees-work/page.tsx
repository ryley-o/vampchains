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
          <span>Piles up at the chain&apos;s wallet</span>
        </div>
        <p className="mt-4 text-sm text-bone-dim/70">
          A small tip on top of every transaction lands as real balance and just accumulates
          there — nothing ever has to move. We keep an exact running count.
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
          anywhere, but we keep an exact running count of it too.
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
    <div className="rounded-2xl border border-hairline bg-ink-raised p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-emerald-300">
          <Dot className="bg-emerald-300" /> Tips
        </p>
        <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-blood-bright">
          Base fee <Dot className="bg-blood-bright" />
        </p>
      </div>

      {/* Both streams flow into one growing bar — a single running total. */}
      <div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-charcoal-soft">
        <div className="animate-grow-x h-full w-full bg-gradient-to-r from-emerald-300 to-blood-bright" />
        <span className="animate-marker-pulse absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-blood" />
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-bone-dim/60">
        <span>Every transaction, forever</span>
        <span>One running total</span>
      </div>

      <p className="mt-4 text-sm text-bone-dim/70">
        Both add into one running total that only goes up. To claim, you show the current total and
        the contract pays out whatever hasn&apos;t been paid yet — so one transaction always settles
        everything you&apos;re owed, whether you claim after a day or a year. Because it tracks the
        total paid rather than any single receipt, the same revenue can never be paid twice.
      </p>
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

      <Section eyebrow="One counter, one claim" title="It all adds into a single number">
        <p>
          Here&apos;s the part that makes this simple: both kinds of revenue feed one running total
          that only ever grows. You never chase individual payments or race a deadline — claim after
          a day or after a year, it&apos;s always exactly one transaction for everything owed.
        </p>
        <TimelineDiagram />
      </Section>

      <Section eyebrow="Who actually does this" title="Anyone can press the button — and that's safe">
        <p>
          Anyone can submit the claim, because the button doesn&apos;t choose where the money goes.
          The three destinations (creator, protocol, runway) are fixed in the contract. Whoever
          clicks it just pays the gas; the money always lands in the same three places.
        </p>
        <p>
          So there&apos;s nothing to steal by racing you to it. If someone submits before you do,
          they&apos;ve just paid gas to send your money to you — and your transaction simply sees
          it&apos;s already done and stops. In practice it&apos;s the chain&apos;s creator or a small
          script pulling revenue in whenever it&apos;s worth the gas.
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
