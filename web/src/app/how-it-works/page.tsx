import Link from "next/link";
import { formatUsdc } from "@/lib/format";
import { getDefaultAnnualFee } from "@/lib/registryReads";
import { HOME_CHAIN_WEB_CONFIGS } from "@/lib/contracts";
import { FangDivider } from "@/components/brand/FangDivider";

export const dynamic = "force-dynamic";

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="py-14 sm:py-16">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-blood">{eyebrow}</p>
      <h2 className="text-display mt-2 text-3xl text-bone sm:text-4xl">{title}</h2>
      <div className="mt-6 space-y-4 text-sm leading-relaxed text-bone-dim/80 sm:text-base">
        {children}
      </div>
    </section>
  );
}

const LIFECYCLE_STEPS = [
  {
    n: "01",
    title: "Active",
    body: "Fully funded and running. Deposits, minting, top-ups, everything works. Anyone can extend the runway at any time — that's the public anti-rug mechanism.",
    tone: "text-emerald-300",
  },
  {
    n: "02",
    title: "Runway runs out",
    body: "The annual fee is drawn down linearly — nobody is ever charged for time not yet served. If nobody's topped it up by the time the paid runway hits zero, the chain doesn't shut off. It moves to a one-week grace period instead.",
    tone: "text-amber-300",
  },
  {
    n: "03",
    title: "Grace period (7 days)",
    body: "The chain stays completely open — same as step 01 — for a full week. This is a real rescue window, not a formality: anyone can top it up and it's back to normal, no funds ever move, nothing is lost.",
    tone: "text-blood-bright",
  },
  {
    n: "04",
    title: "Snapshot",
    body: "If grace expires with no top-up, we take one last read of every real balance the chain had — every wallet, every token — and publish it on the home chain as a cryptographic commitment (a Merkle root). The chain's infrastructure is torn down right after.",
    tone: "text-bone-dim",
  },
  {
    n: "05",
    title: "Claim window (30 days)",
    body: "Anyone who had funds on the chain can look up their wallet and withdraw exactly what the snapshot shows — proven against that published root, so it can't be faked or altered after the fact.",
    tone: "text-bone-dim",
  },
  {
    n: "06",
    title: "Swept",
    body: "After 30 days, whatever's still unclaimed goes to the protocol. The chain itself is gone for good — but a brand new chain for the same token can always be created from scratch afterward.",
    tone: "text-bone-dim/50",
  },
];

const RISKS = [
  "This is unaudited, experimental software run by a small team — not a foundation, not a DAO.",
  "The bridge is secured by a single relayer key we control, not a light client or a multisig. If that key is ever compromised, funds in the bridge are at risk.",
  "The business itself could shut down, and any individual chain can be frozen or torn down — the grace period and snapshot process above are best-effort, not a guarantee.",
  "Funds sitting in other protocols on top of a vampchain (DEXs, lending, anything you build or use there) are at extra risk if that chain is frozen or torn down.",
  "Technical bugs are a real possibility in software this new. Treat everything you bridge in as money you could lose entirely.",
];

export default async function HowItWorksPage() {
  // Quoted from the first configured home chain — the fee is set in USDC
  // terms and expected to match across all three, since it's the same
  // owner-configurable `defaultAnnualFeeUSDC` deployed to each registry.
  const firstConfigured = HOME_CHAIN_WEB_CONFIGS.find((c) => c.configured);
  const defaultAnnualFee = firstConfigured ? await getDefaultAnnualFee(firstConfigured.homeChainId) : 0n;

  return (
    <div className="mx-auto max-w-3xl px-5 py-14 sm:py-16">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-blood">The full picture</p>
      <h1 className="text-display mt-2 text-4xl text-bone sm:text-5xl">How Vampchain works</h1>
      <p className="mt-4 max-w-xl text-base text-bone-dim/70">
        What you get for the fee, what you earn for funding it, and exactly what happens if a
        chain&apos;s funding ever runs out.
      </p>

      <FangDivider className="mt-12" />

      <Section eyebrow="The model" title="Pay once a year, get a whole chain">
        <p>
          Pick any existing ERC20 on Base. Pay the current annual fee —{" "}
          <span className="font-mono text-bone">${formatUsdc(defaultAnnualFee)}</span> in USDC right
          now, though this is owner-adjustable and never changes retroactively for a chain already
          created — and we spin up a single-node EVM sidechain that uses your token as its native
          gas currency. It&apos;s a real chain: real RPC, real blocks, real transactions, running on
          Fly.io within seconds of payment.
        </p>
        <p>
          The fee is drawn down linearly the whole time the chain runs, and it&apos;s fully
          public — anyone can watch a chain&apos;s remaining runway and top it up, whether or not
          they created it. That&apos;s deliberate: nobody, including us, can ever charge for time
          that hasn&apos;t been served yet.
        </p>
      </Section>

      <Section eyebrow="Creator incentives" title="Fund it, and it pays you back">
        <p>
          Every transaction on a vampchain spends a small amount of gas, denominated in that
          chain&apos;s own token. That gas splits into two pieces: a priority fee (a tip to
          whoever produces the block) and a base fee (destroyed outright, per standard Ethereum
          rules). We recapture both — the tip directly, the base fee through an exact on-chain
          accounting mechanism — and split the total <strong className="text-bone">50/50 with
          the chain&apos;s creator</strong>, automatically, for as long as the chain is alive.
        </p>
        <div className="rounded-2xl border border-hairline bg-ink-raised p-5 sm:p-6">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-blood">Worked example</p>
          <p className="mt-3 text-bone-dim/80">
            Say your chain sees enough activity in a month to generate the equivalent of{" "}
            <span className="font-mono text-bone">$40</span> in gas fees. You get{" "}
            <span className="font-mono text-emerald-300">$20</span>, we get{" "}
            <span className="font-mono text-bone-dim">$20</span> — paid out directly in your
            chain&apos;s own token, claimable any time, on top of whatever the token itself is
            worth. A quiet chain with almost no traffic earns almost nothing; a genuinely popular
            one keeps paying its creator indefinitely, not just once at creation.
          </p>
        </div>
        <p>
          This is on top of the one-time creation fee, not instead of it — the annual fee covers
          our infrastructure cost; the fee split is the actual, ongoing reward for having funded
          and grown a chain.
        </p>
      </Section>

      <Section eyebrow="Chain lifecycle" title="What happens if funding runs out">
        <p>
          A vampchain doesn&apos;t just vanish the moment its paid runway hits zero. Here&apos;s
          the full sequence, end to end:
        </p>
        <ol className="mt-2 space-y-5">
          {LIFECYCLE_STEPS.map((step) => (
            <li key={step.n} className="flex gap-4">
              <span className={`font-mono text-sm ${step.tone}`}>{step.n}</span>
              <div>
                <p className="text-display text-lg text-bone">{step.title}</p>
                <p className="mt-1 text-bone-dim/70">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="pt-2">
          Already on the receiving end of a teardown?{" "}
          <Link href="/claim" className="text-bone underline underline-offset-2 hover:text-blood-bright">
            Look up your wallet
          </Link>{" "}
          to see if you have anything to claim.
        </p>
      </Section>

      <Section eyebrow="Read this part" title="Real risk, stated plainly">
        <ul className="space-y-3">
          {RISKS.map((risk) => (
            <li key={risk} className="flex gap-3">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blood-bright" />
              <span>{risk}</span>
            </li>
          ))}
        </ul>
        <p className="pt-2">
          This page is the plain-language version.{" "}
          <Link href="/terms" className="text-bone underline underline-offset-2 hover:text-blood-bright">
            Read the full terms
          </Link>{" "}
          before you bridge anything you can&apos;t afford to lose forever.
        </p>
      </Section>

      <FangDivider className="mb-10" />

      <div className="flex flex-wrap items-center justify-center gap-4 pb-4 text-center">
        <Link
          href="/create"
          className="rounded-full bg-blood px-7 py-3.5 text-sm font-semibold uppercase tracking-wider text-bone shadow-[0_0_40px_rgba(226,45,58,0.35)] transition-all hover:scale-105 hover:bg-blood-bright active:scale-95"
        >
          Create your chain
        </Link>
        <Link
          href="/claim"
          className="rounded-full border border-hairline-strong px-7 py-3.5 text-sm font-semibold text-bone-dim transition-colors hover:border-bone-dim hover:text-bone"
        >
          Look up a claim
        </Link>
      </div>
    </div>
  );
}
