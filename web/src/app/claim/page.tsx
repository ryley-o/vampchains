import { ClaimLookup } from "@/components/ClaimLookup";

export default function ClaimPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-5 py-14 sm:py-16">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-blood">Wind-down claims</p>
        <h1 className="text-display mt-1.5 text-4xl text-bone sm:text-5xl">Claim your funds</h1>
        <p className="mt-3 text-sm text-bone-dim/60">
          If a chain you bridged into ran out its grace period and was torn down, look up your
          wallet below — anything you still had on that chain at the moment of its final snapshot
          is claimable here for 30 days afterward.
        </p>
      </div>
      <ClaimLookup />
    </div>
  );
}
