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
    body: "Fully funded and running — deposits, minting, top-ups, everything works. Anyone can extend the runway; that's the public anti-rug mechanism.",
    tone: "text-emerald-300",
  },
  {
    n: "02",
    title: "Runway runs out",
    body: "Paid runway hits zero. The chain doesn't shut off — it moves into a one-week grace period.",
    tone: "text-amber-300",
  },
  {
    n: "03",
    title: "Grace period (7 days)",
    body: "Stays fully open for a week — same as step 01. A real rescue window: top it up and it's back to normal, nothing lost.",
    tone: "text-blood-bright",
  },
  {
    n: "04",
    title: "Snapshot",
    body: "If grace expires unfunded, we take one last read of every real balance — every wallet, every token — and publish it on the home chain as a Merkle root. Infrastructure is torn down right after.",
    tone: "text-bone-dim",
  },
  {
    n: "05",
    title: "Claim window (30 days)",
    body: "Anyone with funds on the chain can look up their wallet and withdraw exactly what the snapshot shows, proven against that root.",
    tone: "text-bone-dim",
  },
  {
    n: "06",
    title: "Swept",
    body: "Whatever's still unclaimed after 30 days goes to the protocol. The chain is gone for good — a new one for the same token can always be created from scratch.",
    tone: "text-bone-dim/50",
  },
];

const RISKS = [
  "Unaudited, experimental software run by a small team — not a foundation, not a DAO.",
  "The bridge is secured by a single relayer key we control, not a light client or multisig. If that key is compromised, bridged funds are at risk.",
  "The business could shut down, and any chain can be frozen or torn down — the grace period and snapshot process are best-effort, not a guarantee.",
  "Funds in other protocols on top of a vampchain (DEXs, lending, anything you build there) carry extra risk if that chain is frozen or torn down.",
  "Bugs are a real possibility in software this new. Treat everything you bridge in as money you could lose entirely.",
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
        What you get for the fee, what you earn from it, and what happens if funding runs out.
      </p>

      <FangDivider className="mt-12" />

      <Section eyebrow="The model" title="Pay once a year, get a whole chain">
        <p>
          Pick any existing ERC20 on Base, Ethereum, or Robinhood Chain. Pay the annual fee —
          currently <span className="font-mono text-bone">${formatUsdc(defaultAnnualFee)}</span>{" "}
          in USDC — and we spin up a single-node EVM chain that runs on your token as gas.
          It&apos;s real: real RPC, real blocks, real transactions, usually live well under a
          minute after payment.
        </p>
        <p>
          The fee drains linearly over the year, and it&apos;s fully public — anyone can top up a
          chain&apos;s runway, not just its creator. Nobody, including us, can charge for time not
          yet served.
        </p>
        <p className="text-xs text-bone-dim/40">
          Exact fee mechanics — including the rare cases where we&apos;d adjust an existing
          chain&apos;s rate — are in the{" "}
          <Link href="/terms" className="underline underline-offset-2 hover:text-bone-dim/70">
            terms
          </Link>
          .
        </p>
      </Section>

      <Section eyebrow="Creator incentives" title="Fund it, and it pays you back">
        <p>
          Every transaction spends gas in the chain&apos;s own token — split into a priority fee
          (a tip to the block producer) and a base fee (burned outright, standard Ethereum rules).
          We recapture both and split the total{" "}
          <strong className="text-bone">
            three ways, automatically, for as long as the chain runs: a third to the creator, a
            third to the protocol, a third back into the chain&apos;s own funding
          </strong>
          .
        </p>
        <div className="rounded-2xl border border-hairline bg-ink-raised p-5 sm:p-6">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-blood">Worked example</p>
          <p className="mt-3 text-bone-dim/80">
            Say your chain generates <span className="font-mono text-bone">$90</span> in gas fees
            this month. You get <span className="font-mono text-emerald-300">$30</span>, we get{" "}
            <span className="font-mono text-bone-dim">$30</span>,{" "}
            <span className="font-mono text-blood-bright">$30</span>{" "}
            goes to its runway — paid in your chain&apos;s own token, claimable any time, on top of
            whatever the token&apos;s worth. A quiet chain earns almost nothing; a popular one pays
            its creator indefinitely, not just once at creation.
          </p>
        </div>
        <p>
          This is on top of the annual fee, not instead of it — the fee covers our
          infrastructure; the split is the ongoing reward for growing a chain.
        </p>
        <p>
          Curious how the revenue actually adds up and gets claimed?{" "}
          <Link
            href="/how-fees-work"
            className="font-semibold text-blood-bright underline underline-offset-4 hover:text-blood"
          >
            See how fees work
          </Link>{" "}
          — with an interactive walkthrough.
        </p>
      </Section>

      <Section eyebrow="User incentives" title="Using a chain keeps it alive">
        <p>
          Bridging into an obscure chain is a real risk — not losing a trade, but the chain
          flatlining. That&apos;s what the runway third above is for: it goes to a wallet kept
          separate from the protocol&apos;s own share, earmarked for conversion back into that
          chain&apos;s funding on a best-effort basis. The more a chain gets used, the more its own
          users extend its life. Every chain page shows exactly how much that wallet is holding
          and how much it&apos;s actually delivered — live and checkable, not just promised.
        </p>
        <p>
          We also track, and publicly show, how much real gas every wallet has spent per chain —
          we call it <strong className="text-bone">blood given</strong>. No payout, just a
          leaderboard: credit for whoever&apos;s actually keeping a chain&apos;s lights on. Check
          any chain&apos;s page for its top donors.
        </p>
      </Section>

      <Section eyebrow="Chain lifecycle" title="What happens if funding runs out">
        <p>A vampchain doesn&apos;t vanish the moment its paid runway hits zero. Here&apos;s the sequence:</p>
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
          Chain torn down?{" "}
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
          href="/how-fees-work"
          className="rounded-full border border-hairline-strong px-7 py-3.5 text-sm font-semibold text-bone-dim transition-colors hover:border-bone-dim hover:text-bone"
        >
          How fees work
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
