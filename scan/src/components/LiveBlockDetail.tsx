"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Block } from "viem";
import { getChainClient } from "@/lib/gatewayClient";
import { shortAddress, shortHash, timeAgo } from "@/lib/format";

export function LiveBlockDetail({ evmChainId, blockNumber }: { evmChainId: string; blockNumber: string }) {
  const [block, setBlock] = useState<Block | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const client = getChainClient(evmChainId);

    client
      .getBlock({ blockNumber: BigInt(blockNumber), includeTransactions: true })
      .then((b) => {
        if (!cancelled) setBlock(b);
      })
      .catch(() => {
        if (!cancelled) setError("Block not found, or the chain's node couldn't be reached.");
      });

    return () => {
      cancelled = true;
    };
  }, [evmChainId, blockNumber]);

  if (error) return <p className="text-sm text-blood-bright">{error}</p>;
  if (!block) return <p className="text-sm text-bone-dim/50">Loading…</p>;

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-1 gap-4 rounded-2xl border border-hairline bg-ink-raised p-6 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-bone-dim/50">Hash</dt>
          <dd className="mt-1 break-all font-mono text-bone">{block.hash}</dd>
        </div>
        <div>
          <dt className="text-bone-dim/50">Timestamp</dt>
          <dd className="mt-1 text-bone">
            {new Date(Number(block.timestamp) * 1000).toLocaleString()}
            {" "}({timeAgo(block.timestamp)})
          </dd>
        </div>
        <div>
          <dt className="text-bone-dim/50">Gas used / limit</dt>
          <dd className="mt-1 font-mono text-bone">
            {block.gasUsed.toString()}
            {" "}/{" "}
            {block.gasLimit.toString()}
          </dd>
        </div>
        <div>
          <dt className="text-bone-dim/50">Base fee</dt>
          <dd className="mt-1 font-mono text-bone">
            {block.baseFeePerGas?.toString() ?? "—"}
            {" "}wei
          </dd>
        </div>
        <div>
          <dt className="text-bone-dim/50">Miner (Clique signer)</dt>
          <dd className="mt-1 font-mono text-bone">{block.miner}</dd>
        </div>
        <div>
          <dt className="text-bone-dim/50">Transactions</dt>
          <dd className="mt-1 text-bone">{block.transactions.length}</dd>
        </div>
      </dl>

      <div className="rounded-2xl border border-hairline bg-ink-raised p-6">
        <h2 className="text-display text-lg text-bone">Transactions</h2>
        {block.transactions.length === 0 ? (
          <p className="mt-3 text-sm text-bone-dim/50">No transactions in this block.</p>
        ) : (
          <table className="mt-4 w-full text-left text-sm">
            <thead className="font-mono text-[11px] uppercase tracking-wider text-bone-dim/40">
              <tr>
                <th className="pb-2 font-normal">Hash</th>
                <th className="pb-2 font-normal">From</th>
                <th className="pb-2 font-normal">To</th>
                <th className="pb-2 font-normal">Value</th>
              </tr>
            </thead>
            <tbody>
              {block.transactions.map((tx) =>
                typeof tx === "string" ? null : (
                  <tr key={tx.hash} className="border-t border-hairline">
                    <td className="py-2.5">
                      <Link href={`/${evmChainId}/tx/${tx.hash}`} className="font-mono text-xs text-bone hover:text-blood-bright">
                        {shortHash(tx.hash)}
                      </Link>
                    </td>
                    <td className="py-2.5">
                      <Link href={`/${evmChainId}/address/${tx.from}`} className="font-mono text-xs text-bone-dim hover:text-blood-bright">
                        {shortAddress(tx.from)}
                      </Link>
                    </td>
                    <td className="py-2.5">
                      {tx.to ? (
                        <Link href={`/${evmChainId}/address/${tx.to}`} className="font-mono text-xs text-bone-dim hover:text-blood-bright">
                          {shortAddress(tx.to)}
                        </Link>
                      ) : (
                        <span className="font-mono text-xs text-bone-dim/40">contract creation</span>
                      )}
                    </td>
                    <td className="py-2.5 font-mono text-xs text-bone-dim/70">
                      {tx.value.toString()}
                      {" "}wei
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
