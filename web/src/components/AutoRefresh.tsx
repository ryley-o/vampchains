"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/// Re-fetches the current server-rendered page on an interval — used on
/// the chain detail page while a chain is PENDING_PROVISION/PROVISIONING,
/// so it actually becomes ACTIVE on screen without a manual reload, rather
/// than just claiming it will.
export function AutoRefresh({ intervalMs = 4000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
