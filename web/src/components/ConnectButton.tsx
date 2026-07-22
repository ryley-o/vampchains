"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { shortAddress } from "@/lib/format";

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();

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

  const injected = connectors.find((c) => c.id === "injected") ?? connectors[0];
  // wagmi's ConnectErrorType union doesn't list ProviderNotFoundError even
  // though it's a real runtime error name (thrown when no injected wallet
  // exists) — compare as a plain string rather than the narrowed literal type.
  const noProviderFound = (error?.name as string | undefined) === "ProviderNotFoundError";

  return (
    <div className="relative flex items-center">
      <button
        onClick={() => injected && connect({ connector: injected })}
        disabled={isPending || !injected}
        className="rounded-full bg-blood px-4 py-1.5 text-sm font-semibold text-bone transition-colors hover:bg-blood-bright disabled:opacity-50"
      >
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
      {error && (
        <p
          role="alert"
          className="absolute right-0 top-full z-10 mt-2 w-64 rounded-lg border border-hairline-strong bg-ink-raised px-3 py-2 text-right font-mono text-[11px] leading-snug text-blood-bright shadow-lg"
        >
          {noProviderFound
            ? "No wallet extension found in this browser. On mobile, open vampchain.com inside your wallet app's built-in browser (MetaMask, Rabby, Coinbase Wallet) to connect."
            : error.message}
        </p>
      )}
    </div>
  );
}
