import Link from "next/link";
import { CreateChainForm } from "@/components/CreateChainForm";
import { FangDivider } from "@/components/brand/FangDivider";

export default function CreatePage() {
  return (
    <div className="mx-auto max-w-xl px-5 py-16 sm:py-20">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-blood">New chain</p>
      <h1 className="text-display mt-2 text-4xl text-bone sm:text-5xl">Give it a universe.</h1>
      <p className="mt-4 text-base text-bone-dim/70">
        Any existing ERC20 qualifies. Pay the annual fee, and we spin up a single-node sidechain
        that runs on your token as gas — and split its ongoing gas revenue three ways with you and
        the chain&apos;s own runway for as long as it runs.{" "}
        <Link href="/how-it-works" className="text-blood underline underline-offset-2 hover:text-blood-bright">
          How it all works →
        </Link>
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2">
        <p className="flex items-center gap-2 text-xs text-bone-dim/60">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
          <span>
            You keep <span className="font-semibold text-emerald-300">1/3 of every gas fee</span>, forever
          </span>
        </p>
        <p className="flex items-center gap-2 text-xs text-bone-dim/60">
          <span className="h-1.5 w-1.5 shrink-0 animate-heartbeat rounded-full bg-blood" />
          <span>
            Every user <span className="font-semibold text-blood-bright">helps fund its runway</span>
          </span>
        </p>
      </div>
      <FangDivider className="my-10" />
      <CreateChainForm />
      <p className="mt-8 text-xs leading-relaxed text-bone-dim/40">
        This is experimental, unaudited software. If the chain&apos;s funding ever runs out, it
        gets a one-week grace period before anything is torn down, and a 30-day window to claim
        funds back afterward — read the{" "}
        <Link href="/terms" className="underline underline-offset-2 hover:text-bone-dim/70">
          full terms
        </Link>{" "}
        before you commit anything you can&apos;t afford to lose.
      </p>
    </div>
  );
}
