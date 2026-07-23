"use client";

import { useState } from "react";
import { isAddress } from "viem";
import { VERIFIER_URL } from "@/lib/verifierClient";

interface VerifyResult {
  success: boolean;
  matchType?: "full" | "partial";
  error?: string;
  abi?: unknown[];
}

/// Every vampchain is permanently capped at the London fork (genesis has no
/// post-London fork blocks) — the verifier rejects anything targeting a
/// later fork rather than silently coercing it, so this form doesn't even
/// offer the choice: it always submits evmVersion: "london".
const EVM_VERSION = "london";

export function VerifyForm({ evmChainId }: { evmChainId: string }) {
  const [address, setAddress] = useState("");
  const [contractName, setContractName] = useState("");
  const [compilerVersion, setCompilerVersion] = useState("0.8.24");
  const [optimizerEnabled, setOptimizerEnabled] = useState(true);
  const [optimizerRuns, setOptimizerRuns] = useState(200);
  const [viaIr, setViaIr] = useState(false);
  const [sourceCode, setSourceCode] = useState("");
  const [constructorArgs, setConstructorArgs] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);

  const canSubmit = isAddress(address) && contractName.trim().length > 0 && sourceCode.trim().length > 0 && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setResult(null);

    const standardJsonInput = {
      language: "Solidity",
      sources: { [`${contractName}.sol`]: { content: sourceCode } },
      settings: {
        optimizer: { enabled: optimizerEnabled, runs: optimizerRuns },
        evmVersion: EVM_VERSION,
        viaIR: viaIr,
        libraries: {},
        outputSelection: { "*": { "*": ["abi", "evm.deployedBytecode.object"] } },
      },
    };

    try {
      const res = await fetch(`${VERIFIER_URL}/api/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evmChainId,
          address,
          contractName,
          compilerVersion,
          standardJsonInput,
          constructorArgs: constructorArgs.trim() || undefined,
        }),
      });
      const body = (await res.json()) as VerifyResult;
      setResult(body);
    } catch {
      setResult({ success: false, error: "Couldn't reach the verifier service." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="text-xs text-bone-dim/60">Contract address</label>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="0x..."
          className="mt-1 w-full rounded-lg border border-hairline bg-ink px-3 py-2 font-mono text-sm text-bone"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-bone-dim/60">Contract name</label>
          <input
            value={contractName}
            onChange={(e) => setContractName(e.target.value)}
            placeholder="Greeter"
            className="mt-1 w-full rounded-lg border border-hairline bg-ink px-3 py-2 font-mono text-sm text-bone"
          />
        </div>
        <div>
          <label className="text-xs text-bone-dim/60">Compiler version</label>
          <input
            value={compilerVersion}
            onChange={(e) => setCompilerVersion(e.target.value)}
            placeholder="0.8.24"
            className="mt-1 w-full rounded-lg border border-hairline bg-ink px-3 py-2 font-mono text-sm text-bone"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-6">
        <label className="flex items-center gap-2 text-xs text-bone-dim/60">
          <input type="checkbox" checked={optimizerEnabled} onChange={(e) => setOptimizerEnabled(e.target.checked)} />
          Optimizer enabled
        </label>
        <label className="flex items-center gap-2 text-xs text-bone-dim/60">
          Runs
          <input
            type="number"
            value={optimizerRuns}
            onChange={(e) => setOptimizerRuns(Number(e.target.value))}
            className="w-20 rounded-lg border border-hairline bg-ink px-2 py-1 font-mono text-xs text-bone"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-bone-dim/60">
          <input type="checkbox" checked={viaIr} onChange={(e) => setViaIr(e.target.checked)} />
          via_ir
        </label>
        <span className="text-xs text-bone-dim/40">evm_version: london (fixed — see note below)</span>
      </div>

      <div>
        <label className="text-xs text-bone-dim/60">Source code (single file)</label>
        <textarea
          value={sourceCode}
          onChange={(e) => setSourceCode(e.target.value)}
          rows={14}
          placeholder="// SPDX-License-Identifier: MIT&#10;pragma solidity ^0.8.24;&#10;&#10;contract Greeter { ... }"
          className="mt-1 w-full rounded-lg border border-hairline bg-ink px-3 py-2 font-mono text-xs text-bone"
        />
      </div>

      <div>
        <label className="text-xs text-bone-dim/60">Constructor arguments (ABI-encoded hex, optional)</label>
        <input
          value={constructorArgs}
          onChange={(e) => setConstructorArgs(e.target.value)}
          placeholder="0x..."
          className="mt-1 w-full rounded-lg border border-hairline bg-ink px-3 py-2 font-mono text-xs text-bone"
        />
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="rounded-full border border-blood/60 px-5 py-2.5 text-sm font-medium text-blood-bright hover:bg-blood/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? "Compiling & verifying…" : "Submit for verification"}
      </button>

      {result && (
        <div
          className={`rounded-2xl border p-5 text-sm ${
            result.success ? "border-emerald-800/60 bg-emerald-950/20 text-emerald-200" : "border-blood/40 bg-blood/5 text-blood-bright"
          }`}
        >
          {result.success ? (
            <p>Verified — {result.matchType} match.</p>
          ) : (
            <p className="whitespace-pre-wrap">{result.error ?? "Verification failed."}</p>
          )}
        </div>
      )}
    </form>
  );
}
