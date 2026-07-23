"use client";

import { useEffect, useState } from "react";
import { isAddress } from "viem";
import { useAccount } from "wagmi";
import { formatTokenAmount, shortAddress } from "@/lib/format";

interface Contribution {
  evmChainId: string;
  chainName: string;
  chainSymbol: string;
  amount: string;
}

/// Personal "how much blood have I given" lookup — same shape as
/// ClaimLookup (address in, per-chain results out), but purely
/// informational: nothing here is claimable, it's a leaderboard credit,
/// not a payout.
export function DonorLookup() {
  const { address: connectedAddress } = useAccount();
  const [input, setInput] = useState("");
  const [lookupAddress, setLookupAddress] = useState<`0x${string}` | null>(null);
  const [contributions, setContributions] = useState<Contribution[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (connectedAddress && !input) setInput(connectedAddress);
  }, [connectedAddress, input]);

  async function lookup(addr: string) {
    if (!isAddress(addr)) {
      setError("Enter a valid address.");
      return;
    }
    setLoading(true);
    setError(null);
    setLookupAddress(addr);
    try {
      const res = await fetch(`/api/gas-contributions?address=${addr}`);
      const data = await res.json();
      setContributions(data.contributions ?? []);
    } catch {
      setError("Lookup failed — try again in a moment.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="0x… wallet address"
          className="min-w-0 flex-1 rounded-xl border border-hairline bg-ink-raised px-3 py-2 font-mono text-sm text-bone placeholder:text-bone-dim/30 focus:border-blood/60"
        />
        <button
          disabled={loading}
          onClick={() => lookup(input)}
          className="rounded-xl bg-bone px-4 py-2 text-sm font-semibold text-ink transition-transform hover:scale-[1.03] disabled:opacity-40"
        >
          {loading ? "Looking up…" : "Look up"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-blood-bright">{error}</p>}

      {contributions !== null && (
        <div className="mt-6 space-y-3">
          {contributions.length === 0 ? (
            <p className="text-sm text-bone-dim/50">
              No blood given yet by {lookupAddress ? shortAddress(lookupAddress) : "this address"} on any chain.
            </p>
          ) : (
            contributions.map((c) => (
              <div
                key={c.evmChainId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-ink-raised px-4 py-3"
              >
                <p className="text-sm text-bone">
                  {c.chainName} <span className="font-mono text-bone-dim/50">(${c.chainSymbol})</span>
                </p>
                <p className="font-mono text-sm text-blood-bright">
                  {formatTokenAmount(BigInt(c.amount), 18)} <span className="text-bone-dim/50">${c.chainSymbol}</span>
                </p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
