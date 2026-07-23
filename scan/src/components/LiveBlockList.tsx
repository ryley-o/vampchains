"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getChainClient } from "@/lib/gatewayClient";
import { shortHash, timeAgo } from "@/lib/format";

interface BlockRow {
  number: bigint;
  hash: string;
  timestamp: bigint;
  txCount: number;
}

/// The full-app version of web/'s ExplorerPanel — same "no indexer, poll
/// the chain's own node directly" philosophy, just a bigger list. Runs
/// entirely client-side; see gatewayClient.ts for why that's load-bearing,
/// not incidental.
export function LiveBlockList({ evmChainId, limit = 15 }: { evmChainId: string; limit?: number }) {
  const [blocks, setBlocks] = useState<BlockRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const client = getChainClient(evmChainId);

    async function load() {
      try {
        const latest = await client.getBlockNumber();
        const numbers = Array.from({ length: Math.min(limit, Number(latest) + 1) }, (_, i) => latest - BigInt(i));
        const fetched = await Promise.all(
          numbers.map(async (n) => {
            const block = await client.getBlock({ blockNumber: n });
            return { number: block.number, hash: block.hash, timestamp: block.timestamp, txCount: block.transactions.length };
          })
        );
        if (!cancelled) {
          setBlocks(fetched);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Couldn't reach this chain's node through the gateway.");
      }
    }

    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [evmChainId, limit]);

  if (error) return <p className="text-sm text-blood-bright">{error}</p>;
  if (!blocks) return <p className="text-sm text-bone-dim/50">Loading…</p>;

  return (
    <table className="w-full text-left text-sm">
      <thead className="font-mono text-[11px] uppercase tracking-wider text-bone-dim/40">
        <tr>
          <th className="pb-2 font-normal">Block</th>
          <th className="pb-2 font-normal">Hash</th>
          <th className="pb-2 font-normal">Txs</th>
          <th className="pb-2 font-normal">Age</th>
        </tr>
      </thead>
      <tbody>
        {blocks.map((b) => (
          <tr key={b.number.toString()} className="border-t border-hairline">
            <td className="py-2.5">
              <Link href={`/${evmChainId}/block/${b.number}`} className="font-mono text-bone hover:text-blood-bright">
                {b.number.toString()}
              </Link>
            </td>
            <td className="py-2.5 font-mono text-xs text-bone-dim/50">{shortHash(b.hash)}</td>
            <td className="py-2.5 text-bone-dim/70">{b.txCount}</td>
            <td className="py-2.5 text-bone-dim/50">{timeAgo(b.timestamp)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
