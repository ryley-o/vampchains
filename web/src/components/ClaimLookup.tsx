"use client";

import { useEffect, useState } from "react";
import { isAddress, zeroAddress } from "viem";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { BRIDGE_ABI, BRIDGE_ADDRESS } from "@/lib/contracts";
import { formatTokenAmount, shortAddress } from "@/lib/format";

interface Claim {
  chainId: string;
  chainName: string;
  chainSymbol: string;
  token: string;
  amount: string;
  proof: string[];
  claimed: boolean;
}

function ClaimRow({ claim, lookupAddress }: { claim: Claim; lookupAddress: `0x${string}` }) {
  const isNative = claim.token.toLowerCase() === zeroAddress;
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({ hash });

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-ink-raised px-4 py-3">
      <div>
        <p className="text-sm text-bone">
          {claim.chainName} <span className="font-mono text-bone-dim/50">(${claim.chainSymbol})</span>
        </p>
        <p className="mt-0.5 font-mono text-xs text-bone-dim/50">
          {isNative ? formatTokenAmount(BigInt(claim.amount), 18) : `${claim.amount} raw units`}{" "}
          {isNative ? `$${claim.chainSymbol}` : `of ${shortAddress(claim.token)}`}
        </p>
      </div>
      {claim.claimed || confirmed ? (
        <span className="rounded-full border border-emerald-800/60 bg-emerald-950/30 px-3 py-1 text-xs text-emerald-300">
          Claimed
        </span>
      ) : (
        <button
          disabled={isPending || confirming}
          onClick={() =>
            writeContract({
              address: BRIDGE_ADDRESS,
              abi: BRIDGE_ABI,
              functionName: "claimSnapshot",
              args: [BigInt(claim.chainId), claim.token as `0x${string}`, lookupAddress, BigInt(claim.amount), claim.proof],
            })
          }
          className="rounded-lg bg-blood px-3 py-1.5 text-xs font-semibold text-bone transition-colors hover:bg-blood-bright disabled:opacity-40"
        >
          {isPending || confirming ? "Claiming…" : "Claim"}
        </button>
      )}
      {error && <p className="w-full font-mono text-xs text-blood-bright">{error.message}</p>}
    </div>
  );
}

export function ClaimLookup() {
  const { address: connectedAddress } = useAccount();
  const [input, setInput] = useState("");
  const [lookupAddress, setLookupAddress] = useState<`0x${string}` | null>(null);
  const [claims, setClaims] = useState<Claim[] | null>(null);
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
      const res = await fetch(`/api/snapshot-claims?address=${addr}`);
      const data = await res.json();
      setClaims(data.claims ?? []);
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

      {claims !== null && (
        <div className="mt-6 space-y-3">
          {claims.length === 0 ? (
            <p className="text-sm text-bone-dim/50">
              No claimable funds found for {lookupAddress ? shortAddress(lookupAddress) : "this address"} on any
              deactivated chain.
            </p>
          ) : (
            claims.map((claim) => (
              <ClaimRow key={`${claim.chainId}-${claim.token}`} claim={claim} lookupAddress={lookupAddress!} />
            ))
          )}
        </div>
      )}
    </div>
  );
}
