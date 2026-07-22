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
        that runs on your token as gas — and split its ongoing gas revenue 50/50 with you for as
        long as it runs.{" "}
        <Link href="/how-it-works" className="text-blood underline underline-offset-2 hover:text-blood-bright">
          How it all works →
        </Link>
      </p>
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
