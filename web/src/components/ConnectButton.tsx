"use client";

import { useState } from "react";
import { type Connector, useAccount, useConnect, useDisconnect } from "wagmi";
import { shortAddress } from "@/lib/format";

const CONNECTOR_LABELS: Record<string, string> = {
  injected: "Browser wallet",
  walletConnect: "WalletConnect (mobile)",
};

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const [menuOpen, setMenuOpen] = useState(false);

  if (isConnected && address) {
    return (
      <button
        onClick={() => disconnect()}
        className="rounded-full border border-hairline-strong px-4 py-1.5 font-mono text-sm text-bone-dim transition-colors hover:border-blood/50 hover:text-bone"
      >
        {shortAddress(address)}
      </button>
    );
  }

  const hasChoice = connectors.length > 1;
  const noProviderFound = (error?.name as string | undefined) === "ProviderNotFoundError";

  function handleConnect(connector: Connector) {
    setMenuOpen(false);
    connect({ connector });
  }

  return (
    <div className="relative flex items-center">
      <button
        onClick={() => (hasChoice ? setMenuOpen((v) => !v) : connectors[0] && handleConnect(connectors[0]))}
        disabled={isPending || connectors.length === 0}
        className="rounded-full bg-blood px-4 py-1.5 text-sm font-semibold text-bone transition-colors hover:bg-blood-bright disabled:opacity-50"
      >
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>

      {menuOpen && (
        <>
          <button
            aria-label="Close"
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute right-0 top-full z-20 mt-2 w-52 overflow-hidden rounded-xl border border-hairline-strong bg-ink-raised shadow-lg">
            {connectors.map((c) => (
              <button
                key={c.uid}
                onClick={() => handleConnect(c)}
                className="block w-full px-4 py-2.5 text-left text-sm text-bone-dim transition-colors hover:bg-charcoal-soft hover:text-bone"
              >
                {CONNECTOR_LABELS[c.id] ?? c.name}
              </button>
            ))}
          </div>
        </>
      )}

      {error && !menuOpen && (
        <p
          role="alert"
          className="absolute right-0 top-full z-10 mt-2 w-64 rounded-lg border border-hairline-strong bg-ink-raised px-3 py-2 text-right font-mono text-[11px] leading-snug text-blood-bright shadow-lg"
        >
          {noProviderFound
            ? hasChoice
              ? "No wallet extension found in this browser. Tap Connect wallet again and choose WalletConnect to pair with a mobile wallet instead."
              : "No wallet extension found in this browser. On mobile, open vampchain.com inside your wallet app's built-in browser (MetaMask, Rabby, Coinbase Wallet) to connect."
            : error.message}
        </p>
      )}
    </div>
  );
}
