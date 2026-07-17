"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { shortAddress } from "@/lib/format";

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <button
        onClick={() => disconnect()}
        className="rounded-full border border-neutral-700 px-4 py-1.5 text-sm hover:bg-neutral-800"
      >
        {shortAddress(address)}
      </button>
    );
  }

  const injected = connectors.find((c) => c.id === "injected") ?? connectors[0];

  return (
    <button
      onClick={() => injected && connect({ connector: injected })}
      disabled={isPending || !injected}
      className="rounded-full bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
    >
      {isPending ? "Connecting..." : "Connect Wallet"}
    </button>
  );
}
