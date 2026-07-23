"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const BLOCK_NUMBER_RE = /^\d+$/;

/// Once a chain is picked, search within it — an address/tx hash/block
/// number is an exact RPC lookup the destination page already does live, so
/// this is pure format detection + routing, no indexing required. Shown
/// instead of ChainSearchBar (chain name/symbol only) whenever the current
/// route has an evmChainId, via HeaderSearch.
export function ChainScopedSearchBar({ evmChainId }: { evmChainId: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;

    if (ADDRESS_RE.test(trimmed)) {
      router.push(`/${evmChainId}/address/${trimmed}`);
      return;
    }
    if (TX_HASH_RE.test(trimmed)) {
      router.push(`/${evmChainId}/tx/${trimmed}`);
      return;
    }
    if (BLOCK_NUMBER_RE.test(trimmed)) {
      router.push(`/${evmChainId}/block/${trimmed}`);
      return;
    }
    setError("Enter an address, transaction hash, or block number.");
  }

  return (
    <form onSubmit={onSubmit}>
      <input
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (error) setError(null);
        }}
        placeholder="Address, tx hash, or block number on this chain"
        className="w-full rounded-xl border border-hairline bg-ink-raised px-3 py-2 text-sm text-bone placeholder:text-bone-dim/30 focus:border-blood/60"
      />
      {error && <p className="mt-1 text-xs text-blood-bright">{error}</p>}
    </form>
  );
}
