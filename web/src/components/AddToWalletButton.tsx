"use client";

import { useState } from "react";

function getInjectedProvider() {
  return (window as unknown as { ethereum?: { request: (args: unknown) => Promise<unknown> } }).ethereum;
}

/// A chainlist.org-style one-click "add this network" button — calls the
/// standard EIP-3085 `wallet_addEthereumChain` RPC method directly against
/// whatever injected provider is present. Deliberately not wagmi/viem here:
/// this is a raw wallet_addEthereumChain call, not a connection or a
/// transaction, and every injected wallet (MetaMask, Rabby, Coinbase
/// Wallet, etc.) implements this the same standard way. WalletConnect
/// (mobile, no injected provider) can't add a network this way at all —
/// there's no injected `window.ethereum` to call it against — so this
/// naturally does nothing useful there; callers should only render it
/// when an injected provider might realistically be present (desktop
/// browsers, or a wallet's own in-app browser).
export function AddToWalletButton({
  evmChainId,
  name,
  symbol,
  rpcUrl,
}: {
  evmChainId: bigint;
  name: string;
  symbol: string;
  rpcUrl: string;
}) {
  const [status, setStatus] = useState<"idle" | "adding" | "added" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    const ethereum = getInjectedProvider();
    if (!ethereum) {
      setStatus("error");
      setError("No browser wallet found — open this page inside your wallet's own browser instead.");
      return;
    }

    setStatus("adding");
    setError(null);
    try {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${evmChainId.toString(16)}`,
            chainName: `${name} (Vampchain)`,
            nativeCurrency: { name: symbol, symbol, decimals: 18 },
            rpcUrls: [rpcUrl],
          },
        ],
      });
      setStatus("added");
    } catch (err) {
      setStatus("error");
      // EIP-1193 code 4001: user rejected the request — not really an error.
      const rejected = typeof err === "object" && err !== null && "code" in err && err.code === 4001;
      setError(rejected ? null : err instanceof Error ? err.message : "Couldn't add the network.");
      if (rejected) setStatus("idle");
    }
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={status === "adding"}
        className="rounded-full border border-hairline-strong px-4 py-1.5 text-xs font-semibold text-bone-dim transition-colors hover:border-blood/50 hover:text-bone disabled:opacity-40"
      >
        {status === "added" ? "Added ✓" : status === "adding" ? "Adding…" : "+ Add to wallet"}
      </button>
      {error && <p className="mt-1.5 font-mono text-[11px] text-blood-bright">{error}</p>}
    </div>
  );
}
