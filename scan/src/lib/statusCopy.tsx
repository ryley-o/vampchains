import type { ReactNode } from "react";

/// Mirrors the STATUS_COPY pattern on web/src/app/chains/[evmChainId]/page.tsx
/// — every non-live status gets its own honest, distinct explanation rather
/// than a generic "unavailable." Explorer-specific framing: this is about
/// whether the chain's data can be *viewed* right now, not whether it can be
/// *used* (that's web/'s concern).
export const EXPLORER_STATUS_COPY: Record<string, { tone: string; title: string; body: ReactNode }> = {
  PENDING_PROVISION: {
    tone: "border-amber-800/60 bg-amber-950/20 text-amber-300",
    title: "Spinning up",
    body: "This chain was just created — its node isn't reachable yet. Check back shortly.",
  },
  PROVISIONING: {
    tone: "border-amber-800/60 bg-amber-950/20 text-amber-300",
    title: "Almost there",
    body: "Infrastructure is being provisioned right now. This page will show live data once it's up.",
  },
  PROVISION_FAILED: {
    tone: "border-blood/60 bg-blood/10 text-blood-bright",
    title: "Provisioning failed",
    body: "Something went wrong standing up this chain — there's no node to read from.",
  },
  AWAITING_SNAPSHOT: {
    tone: "border-blood/60 bg-blood/10 text-blood-bright",
    title: "Winding down",
    body: "This chain's grace period just expired and a final snapshot is being taken. It's still briefly reachable internally, but not through the public gateway — the same reason its rpc-gateway route already returns 404.",
  },
  DEACTIVATING: {
    tone: "border-hairline-strong bg-charcoal-soft/40 text-bone-dim",
    title: "Torn down, cleanup in progress",
    body: "The final snapshot is published. Infrastructure teardown is finishing in the background — there's no live node left to read from here.",
  },
  DEACTIVATED: {
    tone: "border-hairline-strong bg-charcoal-soft/40 text-bone-dim",
    title: "Gone for good",
    body: "This chain was torn down. Nothing was ever indexed off-chain, so its block/transaction history is unrecoverable — this explorer has no record of it beyond what's shown here. If you had funds on it, look them up on vampchain.com/claim.",
  },
};

export function isLiveStatus(status: string): boolean {
  return status === "ACTIVE";
}
