const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "border-emerald-800/60 bg-emerald-950/30 text-emerald-300",
  PENDING_PROVISION: "border-amber-800/60 bg-amber-950/30 text-amber-300",
  PROVISIONING: "border-amber-800/60 bg-amber-950/30 text-amber-300",
  AWAITING_SNAPSHOT: "border-blood/60 bg-blood/10 text-blood-bright",
  DEACTIVATING: "border-hairline-strong bg-charcoal-soft/60 text-bone-dim",
  DEACTIVATED: "border-hairline-strong bg-charcoal-soft/60 text-bone-dim",
  PROVISION_FAILED: "border-blood/60 bg-blood/10 text-blood-bright",
};

export function StatusPill({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? "border-hairline-strong bg-charcoal-soft/60 text-bone-dim";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${style}`}
    >
      {status === "ACTIVE" && <span className="h-1.5 w-1.5 animate-heartbeat rounded-full bg-emerald-400" />}
      {status.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}
