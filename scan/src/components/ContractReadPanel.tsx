"use client";

import { useState } from "react";
import type { Abi, AbiFunction } from "viem";
import { getChainClient } from "@/lib/gatewayClient";

/// Read-only, client-side only (`eth_call` via viem, no wallet involved) —
/// this repo's viem/wagmi wallet-connect setup lives only in web/, not
/// here, so a write UI is deliberately out of scope for now. Every function
/// call happens straight from the visitor's browser through the gateway,
/// same discipline as every other RPC read in this app.
export function ContractReadPanel({
  evmChainId,
  address,
  abi,
}: {
  evmChainId: string;
  address: `0x${string}`;
  abi: unknown[];
}) {
  const readFns = (abi as Abi).filter(
    (item): item is AbiFunction => item.type === "function" && (item.stateMutability === "view" || item.stateMutability === "pure")
  );

  if (readFns.length === 0) {
    return <p className="text-xs text-bone-dim/40">No read-only functions in this contract&apos;s ABI.</p>;
  }

  return (
    <div className="space-y-3">
      {readFns.map((fn, i) => (
        <ReadFunctionRow key={`${fn.name}-${i}`} evmChainId={evmChainId} address={address} abi={abi as Abi} fn={fn} />
      ))}
    </div>
  );
}

function ReadFunctionRow({
  evmChainId,
  address,
  abi,
  fn,
}: {
  evmChainId: string;
  address: `0x${string}`;
  abi: Abi;
  fn: AbiFunction;
}) {
  const [args, setArgs] = useState<string[]>(() => fn.inputs.map(() => ""));
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function call() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const client = getChainClient(evmChainId);
      const parsedArgs = fn.inputs.map((input, i) => coerceArg(input.type, args[i] ?? ""));
      const value = await client.readContract({
        address,
        abi,
        functionName: fn.name,
        args: parsedArgs,
      });
      setResult(stringifyResult(value));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Call failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-hairline bg-charcoal-soft/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-bone">{fn.name}</span>
        {fn.inputs.map((input, i) => (
          <input
            key={i}
            value={args[i] ?? ""}
            onChange={(e) => setArgs((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
            placeholder={`${input.name || `arg${i}`}: ${input.type}`}
            className="w-40 rounded-lg border border-hairline bg-ink px-2 py-1 font-mono text-xs text-bone"
          />
        ))}
        <button
          onClick={call}
          disabled={loading}
          className="rounded-full border border-hairline px-3 py-1 text-xs text-bone-dim hover:text-blood-bright disabled:opacity-40"
        >
          {loading ? "Calling…" : "Read"}
        </button>
      </div>
      {result !== null && <p className="mt-2 break-all font-mono text-xs text-emerald-300">{result}</p>}
      {error && <p className="mt-2 text-xs text-blood-bright">{error}</p>}
    </div>
  );
}

function coerceArg(type: string, raw: string): unknown {
  if (type.startsWith("uint") || type.startsWith("int")) return BigInt(raw || "0");
  if (type === "bool") return raw === "true";
  return raw;
}

function stringifyResult(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return `[${value.map(stringifyResult).join(", ")}]`;
  return String(value);
}
