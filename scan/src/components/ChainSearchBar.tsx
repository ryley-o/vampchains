"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/// Postgres-only search — chain name/symbol/creator/evmChainId, never a
/// cross-chain RPC fan-out (there is deliberately no "find which chain this
/// tx hash is on" feature: that would mean querying every active chain's
/// node per keystroke, exactly the cost problem this whole app exists to
/// avoid). A bare number is treated as an evmChainId and navigated to
/// directly; anything else filters the chain list on the landing page.
export function ChainSearchBar() {
  const router = useRouter();
  const [value, setValue] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    if (/^\d+$/.test(trimmed)) {
      router.push(`/${trimmed}`);
      return;
    }
    router.push(`/?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <form onSubmit={onSubmit}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Chain name, symbol, or evmChainId"
        className="w-full rounded-xl border border-hairline bg-ink-raised px-3 py-2 text-sm text-bone placeholder:text-bone-dim/30 focus:border-blood/60"
      />
    </form>
  );
}
