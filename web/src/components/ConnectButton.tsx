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
        className="rounded-full border border-hairline-strong px-4 py-1.5 font-mono text-sm text-bone-dim transition-colors hover:border-blood/50 hover:text-bone"
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
      className="rounded-full bg-blood px-4 py-1.5 text-sm font-semibold text-bone transition-colors hover:bg-blood-bright disabled:opacity-50"
    >
      {isPending ? "Connecting…" : "Connect wallet"}
    </button>
  );
}
