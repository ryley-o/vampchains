const COLORS: Record<string, string> = {
  ACTIVE: "bg-green-900 text-green-300",
  DEACTIVATED: "bg-neutral-800 text-neutral-500",
  DEACTIVATING: "bg-orange-900 text-orange-300",
  PROVISION_FAILED: "bg-red-900 text-red-300",
  PENDING_PROVISION: "bg-yellow-900 text-yellow-300",
  PROVISIONING: "bg-yellow-900 text-yellow-300",
};

export function StatusPill({ status }: { status: string }) {
  const color = COLORS[status] ?? "bg-neutral-800 text-neutral-400";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${color}`}>{status.replace(/_/g, " ").toLowerCase()}</span>;
}
