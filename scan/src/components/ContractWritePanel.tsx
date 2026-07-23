"use client";

import { useState } from "react";
import Link from "next/link";
import type { Abi, AbiFunction } from "viem";
import { createWalletClient, custom, defineChain } from "viem";
import { getChainClient } from "@/lib/gatewayClient";
import { connectInjectedWallet, ensureWalletOnChain, getInjectedEthereum } from "@/lib/injectedWallet";
import { shortAddress } from "@/lib/format";

/// Wallet-connected writes via a plain EIP-1193 provider — see
/// injectedWallet.ts for why this doesn't pull in wagmi. Every call here
/// switches (or adds) the connected wallet to the target vampchain first;
/// submitting to the wrong chain isn't something to leave to chance.
export function ContractWritePanel({
  evmChainId,
  address,
  abi,
  chainName,
  chainSymbol,
  rpcUrl,
}: {
  evmChainId: string;
  address: `0x${string}`;
  abi: unknown[];
  chainName: string;
  chainSymbol: string;
  rpcUrl: string;
}) {
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const writeFns = (abi as Abi).filter(
    (item): item is AbiFunction =>
      item.type === "function" && (item.stateMutability === "nonpayable" || item.stateMutability === "payable")
  );

  if (writeFns.length === 0) {
    return <p className="text-xs text-bone-dim/40">No write functions in this contract&apos;s ABI.</p>;
  }

  async function connect() {
    setConnecting(true);
    setConnectError(null);
    try {
      const acc = await connectInjectedWallet();
      setAccount(acc);
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Couldn't connect wallet.");
    } finally {
      setConnecting(false);
    }
  }

  if (!account) {
    return (
      <div>
        <button
          onClick={connect}
          disabled={connecting}
          className="rounded-full border border-blood/60 px-4 py-2 text-xs font-medium text-blood-bright hover:bg-blood/10 disabled:opacity-40"
        >
          {connecting ? "Connecting…" : "Connect wallet"}
        </button>
        {connectError && <p className="mt-2 text-xs text-blood-bright">{connectError}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-bone-dim/50">Connected: {shortAddress(account)}</p>
      {writeFns.map((fn, i) => (
        <WriteFunctionRow
          key={`${fn.name}-${i}`}
          evmChainId={evmChainId}
          address={address}
          abi={abi as Abi}
          fn={fn}
          account={account}
          chainName={chainName}
          chainSymbol={chainSymbol}
          rpcUrl={rpcUrl}
        />
      ))}
    </div>
  );
}

function WriteFunctionRow({
  evmChainId,
  address,
  abi,
  fn,
  account,
  chainName,
  chainSymbol,
  rpcUrl,
}: {
  evmChainId: string;
  address: `0x${string}`;
  abi: Abi;
  fn: AbiFunction;
  account: `0x${string}`;
  chainName: string;
  chainSymbol: string;
  rpcUrl: string;
}) {
  const [args, setArgs] = useState<string[]>(() => fn.inputs.map(() => ""));
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<"idle" | "pending" | "confirming" | "success" | "error">("idle");
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setStatus("pending");
    setError(null);
    setTxHash(null);
    try {
      const ethereum = getInjectedEthereum();
      await ensureWalletOnChain(ethereum, evmChainId, chainName, chainSymbol, rpcUrl);

      const chain = defineChain({
        id: Number(evmChainId),
        name: `vampchain-${evmChainId}`,
        nativeCurrency: { name: chainSymbol, symbol: chainSymbol, decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      });
      const walletClient = createWalletClient({ account, chain, transport: custom(ethereum) });

      const parsedArgs = fn.inputs.map((input, i) => coerceArg(input.type, args[i] ?? ""));
      const hash = await walletClient.writeContract({
        address,
        abi,
        functionName: fn.name,
        args: parsedArgs,
        value: fn.stateMutability === "payable" && value ? BigInt(value) : undefined,
      });
      setTxHash(hash);
      setStatus("confirming");

      const publicClient = getChainClient(evmChainId);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      setStatus(receipt.status === "success" ? "success" : "error");
      if (receipt.status !== "success") setError("Transaction reverted.");
    } catch (err) {
      setStatus("error");
      const rejected = typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === 4001;
      setError(rejected ? null : err instanceof Error ? err.message : "Write failed.");
      if (rejected) setStatus("idle");
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
        {fn.stateMutability === "payable" && (
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="value (wei)"
            className="w-32 rounded-lg border border-hairline bg-ink px-2 py-1 font-mono text-xs text-bone"
          />
        )}
        <button
          onClick={submit}
          disabled={status === "pending" || status === "confirming"}
          className="rounded-full border border-blood/60 px-3 py-1 text-xs text-blood-bright hover:bg-blood/10 disabled:opacity-40"
        >
          {status === "pending" ? "Confirm in wallet…" : status === "confirming" ? "Confirming…" : "Write"}
        </button>
      </div>
      {txHash && (
        <p className="mt-2 font-mono text-xs text-bone-dim/60">
          <Link href={`/${evmChainId}/tx/${txHash}`} className="hover:text-blood-bright">
            {txHash}
          </Link>
        </p>
      )}
      {status === "success" && <p className="mt-1 text-xs text-emerald-300">Confirmed.</p>}
      {error && <p className="mt-1 text-xs text-blood-bright">{error}</p>}
    </div>
  );
}

function coerceArg(type: string, raw: string): unknown {
  if (type.startsWith("uint") || type.startsWith("int")) return BigInt(raw || "0");
  if (type === "bool") return raw === "true";
  return raw;
}
