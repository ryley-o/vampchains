"use client";

import { useEffect, useState } from "react";
import { type Address, createPublicClient, formatEther, http, isAddress } from "viem";

interface ExplorerPanelProps {
  rpcUrl: string;
  symbol: string;
}

interface BlockSummary {
  number: bigint;
  hash: string;
  timestamp: bigint;
  txCount: number;
}

export function ExplorerPanel({ rpcUrl, symbol }: ExplorerPanelProps) {
  const [blocks, setBlocks] = useState<BlockSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState("");
  const [balance, setBalance] = useState<string | null>(null);

  const client = createPublicClient({ transport: http(rpcUrl) });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const latest = await client.getBlockNumber();
        const numbers = Array.from({ length: Math.min(5, Number(latest) + 1) }, (_, i) => latest - BigInt(i));
        const fetched = await Promise.all(
          numbers.map(async (n) => {
            const block = await client.getBlock({ blockNumber: n });
            return {
              number: block.number,
              hash: block.hash,
              timestamp: block.timestamp,
              txCount: block.transactions.length,
            };
          })
        );
        if (!cancelled) {
          setBlocks(fetched);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Couldn't reach this chain's RPC gateway.");
      }
    }

    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpcUrl]);

  async function checkBalance() {
    if (!isAddress(lookup)) return;
    try {
      const bal = await client.getBalance({ address: lookup as Address });
      setBalance(`${formatEther(bal)} ${symbol}`);
    } catch {
      setBalance("error reading balance");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          value={lookup}
          onChange={(e) => setLookup(e.target.value)}
          placeholder="Look up an address balance"
          className="flex-1 rounded-xl border border-hairline bg-ink-raised px-3 py-2 font-mono text-sm text-bone placeholder:text-bone-dim/30 focus:border-blood/60"
        />
        <button
          onClick={checkBalance}
          className="rounded-xl border border-hairline-strong px-4 py-2 text-sm font-medium text-bone-dim transition-colors hover:border-blood/50 hover:text-bone"
        >
          Check
        </button>
      </div>
      {balance && <p className="font-mono text-sm text-emerald-300">{balance}</p>}

      {error ? (
        <p className="text-sm text-blood-bright">{error}</p>
      ) : blocks.length === 0 ? (
        <p className="text-sm text-bone-dim/50">Loading…</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="font-mono text-[11px] uppercase tracking-wider text-bone-dim/40">
            <tr>
              <th className="pb-2 font-normal">Block</th>
              <th className="pb-2 font-normal">Hash</th>
              <th className="pb-2 font-normal">Txs</th>
              <th className="pb-2 font-normal">Time</th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((b) => (
              <tr key={b.number.toString()} className="border-t border-hairline">
                <td className="py-2.5 font-mono text-bone">{b.number.toString()}</td>
                <td className="py-2.5 font-mono text-xs text-bone-dim/50">
                  {b.hash.slice(0, 10)}…{b.hash.slice(-8)}
                </td>
                <td className="py-2.5 text-bone-dim/70">{b.txCount}</td>
                <td className="py-2.5 text-bone-dim/50">{new Date(Number(b.timestamp) * 1000).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
