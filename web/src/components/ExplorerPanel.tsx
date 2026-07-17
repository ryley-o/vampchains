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
          className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-sm"
        />
        <button onClick={checkBalance} className="rounded border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800">
          Check
        </button>
      </div>
      {balance && <p className="text-sm text-neutral-300">{balance}</p>}

      {error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : blocks.length === 0 ? (
        <p className="text-sm text-neutral-500">Loading...</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-neutral-500">
            <tr>
              <th className="pb-2 font-normal">Block</th>
              <th className="pb-2 font-normal">Hash</th>
              <th className="pb-2 font-normal">Txs</th>
              <th className="pb-2 font-normal">Time</th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((b) => (
              <tr key={b.number.toString()} className="border-t border-neutral-800">
                <td className="py-2">{b.number.toString()}</td>
                <td className="py-2 font-mono text-xs text-neutral-400">
                  {b.hash.slice(0, 10)}...{b.hash.slice(-8)}
                </td>
                <td className="py-2">{b.txCount}</td>
                <td className="py-2 text-neutral-500">{new Date(Number(b.timestamp) * 1000).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
