import { EXPLORER_STATUS_COPY, isLiveStatus } from "@/lib/statusCopy";

/// Every RPC-backed page (block/tx/address detail) needs the same check
/// before attempting any live read: is this chain's node actually reachable
/// right now? Renders the shared status banner instead of the page's real
/// content for anything non-ACTIVE, rather than letting a doomed RPC call
/// fail ugly.
export function ChainGate({ status, children }: { status: string; children: React.ReactNode }) {
  if (isLiveStatus(status)) return <>{children}</>;

  const copy = EXPLORER_STATUS_COPY[status];
  if (!copy) return null;
  return (
    <div className={`rounded-2xl border px-6 py-10 text-center text-sm ${copy.tone}`}>
      <p className="text-display text-lg">{copy.title}</p>
      <p className="mx-auto mt-2 max-w-md leading-relaxed opacity-90">{copy.body}</p>
    </div>
  );
}
