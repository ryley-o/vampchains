const STYLES: Record<string, { dot: string; text: string; pulse?: boolean }> = {
  ACTIVE: { dot: "bg-emerald-400", text: "text-emerald-300", pulse: true },
  DEACTIVATED: { dot: "bg-bone-dim/40", text: "text-bone-dim/50" },
  AWAITING_SNAPSHOT: { dot: "bg-blood-bright", text: "text-blood-bright", pulse: true },
  DEACTIVATING: { dot: "bg-amber-400", text: "text-amber-300" },
  PROVISION_FAILED: { dot: "bg-blood-bright", text: "text-blood-bright" },
  PENDING_PROVISION: { dot: "bg-amber-400", text: "text-amber-300", pulse: true },
  PROVISIONING: { dot: "bg-amber-400", text: "text-amber-300", pulse: true },
};

export function StatusPill({ status }: { status: string }) {
  const style = STYLES[status] ?? { dot: "bg-bone-dim/40", text: "text-bone-dim/50" };
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-hairline bg-charcoal-soft/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${style.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot} ${style.pulse ? "animate-heartbeat" : ""}`} />
      {status.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}
