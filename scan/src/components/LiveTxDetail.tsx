"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { TransactionReceipt, Transaction } from "viem";
import { getChainClient } from "@/lib/gatewayClient";

export function LiveTxDetail({ evmChainId, txHash }: { evmChainId: string; txHash: `0x${string}` }) {
  const [tx, setTx] = useState<Transaction | null>(null);
  const [receipt, setReceipt] = useState<TransactionReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const client = getChainClient(evmChainId);

    Promise.all([client.getTransaction({ hash: txHash }), client.getTransactionReceipt({ hash: txHash })])
      .then(([t, r]) => {
        if (!cancelled) {
          setTx(t);
          setReceipt(r);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Transaction not found, or the chain's node couldn't be reached.");
      });

    return () => {
      cancelled = true;
    };
  }, [evmChainId, txHash]);

  if (error) return <p className="text-sm text-blood-bright">{error}</p>;
  if (!tx || !receipt) return <p className="text-sm text-bone-dim/50">Loading…</p>;

  const succeeded = receipt.status === "success";

  return (
    <div className="space-y-6">
      <div
        className={`rounded-xl border px-4 py-2.5 text-xs font-semibold uppercase tracking-wider ${
          succeeded ? "border-emerald-800/60 bg-emerald-950/30 text-emerald-300" : "border-blood/60 bg-blood/10 text-blood-bright"
        }`}
      >
        {succeeded ? "Success" : "Failed"}
      </div>

      <dl className="grid grid-cols-1 gap-4 rounded-2xl border border-hairline bg-ink-raised p-6 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-bone-dim/50">Block</dt>
          <dd className="mt-1">
            <Link href={`/${evmChainId}/block/${receipt.blockNumber}`} className="font-mono text-bone hover:text-blood-bright">
              {receipt.blockNumber.toString()}
            </Link>
          </dd>
        </div>
        <div>
          <dt className="text-bone-dim/50">Nonce</dt>
          <dd className="mt-1 font-mono text-bone">{tx.nonce}</dd>
        </div>
        <div>
          <dt className="text-bone-dim/50">From</dt>
          <dd className="mt-1">
            <Link href={`/${evmChainId}/address/${tx.from}`} className="break-all font-mono text-bone hover:text-blood-bright">
              {tx.from}
            </Link>
          </dd>
        </div>
        <div>
          <dt className="text-bone-dim/50">To</dt>
          <dd className="mt-1">
            {tx.to ? (
              <Link href={`/${evmChainId}/address/${tx.to}`} className="break-all font-mono text-bone hover:text-blood-bright">
                {tx.to}
              </Link>
            ) : receipt.contractAddress ? (
              <span className="break-all font-mono text-bone">
                contract creation →{" "}
                <Link href={`/${evmChainId}/address/${receipt.contractAddress}`} className="hover:text-blood-bright">
                  {receipt.contractAddress}
                </Link>
              </span>
            ) : (
              <span className="text-bone-dim/40">—</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-bone-dim/50">Value</dt>
          <dd className="mt-1 font-mono text-bone">
            {tx.value.toString()}
            {" "}wei
          </dd>
        </div>
        <div>
          <dt className="text-bone-dim/50">Gas used</dt>
          <dd className="mt-1 font-mono text-bone">
            {receipt.gasUsed.toString()}
            {" "}(limit {tx.gas.toString()})
          </dd>
        </div>
        <div>
          <dt className="text-bone-dim/50">Effective gas price</dt>
          <dd className="mt-1 font-mono text-bone">
            {receipt.effectiveGasPrice.toString()}
            {" "}wei
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-bone-dim/50">Input data</dt>
          <dd className="mt-1 max-h-40 overflow-y-auto break-all rounded-lg bg-charcoal-soft/50 p-3 font-mono text-xs text-bone-dim/70">
            {tx.input === "0x" ? "(none)" : tx.input}
          </dd>
        </div>
      </dl>

      <div className="rounded-2xl border border-hairline bg-ink-raised p-6">
        <h2 className="text-display text-lg text-bone">Logs</h2>
        {receipt.logs.length === 0 ? (
          <p className="mt-3 text-sm text-bone-dim/50">No logs emitted.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {receipt.logs.map((log, i) => (
              <div key={i} className="rounded-lg border border-hairline bg-charcoal-soft/40 p-3 text-xs">
                <Link
                  href={`/${evmChainId}/address/${log.address}`}
                  className="font-mono text-bone-dim hover:text-blood-bright"
                >
                  {log.address}
                </Link>
                {log.topics.map((topic, j) => (
                  <p key={j} className="mt-1 break-all font-mono text-bone-dim/50">
                    topic[{j}]: {topic}
                  </p>
                ))}
                {log.data !== "0x" && <p className="mt-1 break-all font-mono text-bone-dim/50">data: {log.data}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
