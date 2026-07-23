"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatEther, parseAbiItem } from "viem";
import { getChainClient } from "@/lib/gatewayClient";
import { recognizeContract, type ContractRecognition } from "@/lib/contractRecognition";
import { GENESIS_CONTRACTS } from "@vampchains/contract-abis";
import { formatTokenAmount, shortAddress, shortHash, timeAgo } from "@/lib/format";

const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

interface TransferRow {
  txHash: `0x${string}`;
  from: `0x${string}`;
  to: `0x${string}`;
  value: bigint;
  blockNumber: bigint;
}

interface WrappedTokenMeta {
  name: string;
  symbol: string;
  decimals: number;
  l1Token: string;
}

export function LiveAddressDetail({
  evmChainId,
  address,
  chainSymbol,
  wrappedTokenMeta,
  isKnownL1TokenWrapped,
}: {
  evmChainId: string;
  address: `0x${string}`;
  chainSymbol: string;
  wrappedTokenMeta: WrappedTokenMeta | null;
  isKnownL1TokenWrapped: boolean;
}) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [recognition, setRecognition] = useState<ContractRecognition | null>(null);
  const [transfers, setTransfers] = useState<TransferRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const client = getChainClient(evmChainId);

    async function load() {
      try {
        const [bal, code] = await Promise.all([
          client.getBalance({ address }),
          client.getCode({ address }),
        ]);
        if (cancelled) return;
        setBalance(bal);
        setRecognition(recognizeContract(address, code ?? null));

        if (code && code !== "0x") {
          const [outgoing, incoming] = await Promise.all([
            client.getLogs({ event: TRANSFER_EVENT, args: { from: address }, fromBlock: 0n, toBlock: "latest" }),
            client.getLogs({ event: TRANSFER_EVENT, args: { to: address }, fromBlock: 0n, toBlock: "latest" }),
          ]);
          if (cancelled) return;
          const merged = [...outgoing, ...incoming]
            .map((log) => ({
              txHash: log.transactionHash!,
              from: log.args.from!,
              to: log.args.to!,
              value: log.args.value!,
              blockNumber: log.blockNumber!,
            }))
            .sort((a, b) => (b.blockNumber > a.blockNumber ? 1 : -1))
            .slice(0, 25);
          setTransfers(merged);
        }
      } catch {
        if (!cancelled) setError("Couldn't reach this chain's node through the gateway.");
      }
    }

    load();
  }, [evmChainId, address]);

  if (error) return <p className="text-sm text-blood-bright">{error}</p>;
  if (balance === null || recognition === null) return <p className="text-sm text-bone-dim/50">Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-hairline bg-ink-raised p-6">
        <p className="text-xs text-bone-dim/50">Balance</p>
        <p className="mt-1 font-mono text-2xl text-bone">
          {formatEther(balance)} <span className="text-sm text-bone-dim/50">${chainSymbol}</span>
        </p>
      </div>

      <RecognitionPanel recognition={recognition} wrappedTokenMeta={wrappedTokenMeta} isKnownL1TokenWrapped={isKnownL1TokenWrapped} />

      {recognition.kind !== "eoa" && (
        <div className="rounded-2xl border border-hairline bg-ink-raised p-6">
          <h2 className="text-display text-lg text-bone">ERC20 transfers</h2>
          <p className="mt-1 text-xs text-bone-dim/40">
            Only ERC20 Transfer events — native-currency transfer history for an address isn&apos;t
            available yet (vanilla geth has no "all transactions by address" RPC method).
          </p>
          {!transfers ? (
            <p className="mt-4 text-sm text-bone-dim/50">Loading…</p>
          ) : transfers.length === 0 ? (
            <p className="mt-4 text-sm text-bone-dim/50">No ERC20 transfers found.</p>
          ) : (
            <table className="mt-4 w-full text-left text-sm">
              <thead className="font-mono text-[11px] uppercase tracking-wider text-bone-dim/40">
                <tr>
                  <th className="pb-2 font-normal">Tx</th>
                  <th className="pb-2 font-normal">From</th>
                  <th className="pb-2 font-normal">To</th>
                  <th className="pb-2 font-normal">Amount</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t, i) => (
                  <tr key={`${t.txHash}-${i}`} className="border-t border-hairline">
                    <td className="py-2.5">
                      <Link href={`/${evmChainId}/tx/${t.txHash}`} className="font-mono text-xs text-bone hover:text-blood-bright">
                        {shortHash(t.txHash)}
                      </Link>
                    </td>
                    <td className="py-2.5">
                      <Link href={`/${evmChainId}/address/${t.from}`} className="font-mono text-xs text-bone-dim hover:text-blood-bright">
                        {shortAddress(t.from)}
                      </Link>
                    </td>
                    <td className="py-2.5">
                      <Link href={`/${evmChainId}/address/${t.to}`} className="font-mono text-xs text-bone-dim hover:text-blood-bright">
                        {shortAddress(t.to)}
                      </Link>
                    </td>
                    <td className="py-2.5 font-mono text-xs text-bone-dim/70">
                      {wrappedTokenMeta ? formatTokenAmount(t.value, wrappedTokenMeta.decimals) : t.value.toString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function RecognitionPanel({
  recognition,
  wrappedTokenMeta,
  isKnownL1TokenWrapped,
}: {
  recognition: ContractRecognition;
  wrappedTokenMeta: WrappedTokenMeta | null;
  isKnownL1TokenWrapped: boolean;
}) {
  if (recognition.kind === "eoa") {
    return <p className="text-sm text-bone-dim/50">This is a wallet address (no contract code).</p>;
  }

  if (recognition.kind === "genesis-factory" || recognition.kind === "genesis-implementation") {
    const meta =
      recognition.kind === "genesis-factory" ? GENESIS_CONTRACTS.wrappedTokenFactory : GENESIS_CONTRACTS.wrappedTokenImplementation;
    return (
      <div className="rounded-2xl border border-emerald-800/60 bg-emerald-950/20 p-6">
        <p className="font-mono text-xs uppercase tracking-wider text-emerald-300">Verified · genesis contract</p>
        <p className="mt-1 text-sm text-bone">
          {meta.name}
          {" "}
          — baked into every vampchain&apos;s genesis at this exact address. Same bytecode on every chain,
          forever.
        </p>
        <a
          href={`https://github.com/ryley-o/vampchains/blob/main/contracts/src/${meta.name}.sol`}
          className="mt-2 inline-block text-xs text-blood underline underline-offset-2 hover:text-blood-bright"
        >
          View source →
        </a>
      </div>
    );
  }

  if (recognition.kind === "wrapped-token-clone") {
    return (
      <div className="rounded-2xl border border-emerald-800/60 bg-emerald-950/20 p-6">
        <p className="font-mono text-xs uppercase tracking-wider text-emerald-300">Verified · wrapped token clone</p>
        <p className="mt-1 text-sm text-bone">
          An EIP-1167 minimal proxy to VampWrappedToken — the standard clone every general-bridged ERC20
          gets, byte-identical across every vampchain.
        </p>
        {wrappedTokenMeta && (
          <p className="mt-2 font-mono text-xs text-bone-dim/60">
            {wrappedTokenMeta.name}
            {" "}($
            {wrappedTokenMeta.symbol}),{" "}
            {wrappedTokenMeta.decimals} decimals — wraps L1 token{" "}
            {shortAddress(wrappedTokenMeta.l1Token)}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-hairline bg-charcoal-soft/40 p-6">
      <p className="font-mono text-xs uppercase tracking-wider text-bone-dim/50">Unverified contract</p>
      <p className="mt-1 text-sm text-bone-dim/70">
        {isKnownL1TokenWrapped
          ? "This address is an L1 token that's been bridged here, not the contract deployed on this chain."
          : "No verified source available for this contract yet."}
      </p>
    </div>
  );
}
