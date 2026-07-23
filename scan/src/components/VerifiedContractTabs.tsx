"use client";

import { useState } from "react";
import { ContractReadPanel } from "@/components/ContractReadPanel";
import { ContractWritePanel } from "@/components/ContractWritePanel";
import { SourceCodeViewer } from "@/components/SourceCodeViewer";
import type { StandardJsonSources } from "@/lib/standardJsonInput";

type Tab = "source" | "read" | "write";

const TABS: { id: Tab; label: string }[] = [
  { id: "source", label: "Source Code" },
  { id: "read", label: "Read Contract" },
  { id: "write", label: "Write Contract" },
];

/// Etherscan-style tabbed layout for a verified contract — source, read,
/// and write used to be three separate stacked cards; grouping them behind
/// tabs (with SourceCodeViewer's own per-file picker as the "sub-tab"
/// layer within Source Code) reads more like a single contract page and
/// less like three unrelated widgets.
export function VerifiedContractTabs({
  evmChainId,
  address,
  abi,
  sources,
  chainName,
  chainSymbol,
  gatewayRpcUrl,
}: {
  evmChainId: string;
  address: `0x${string}`;
  abi: unknown[];
  sources: StandardJsonSources[];
  chainName: string;
  chainSymbol: string;
  gatewayRpcUrl: string;
}) {
  const [tab, setTab] = useState<Tab>("source");

  return (
    <div className="rounded-2xl border border-hairline bg-ink-raised p-6">
      <div className="flex flex-wrap gap-1 border-b border-hairline pb-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.id ? "bg-blood/20 text-blood-bright" : "text-bone-dim/50 hover:text-bone-dim"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "source" && <SourceCodeViewer sources={sources} />}
        {tab === "read" && <ContractReadPanel evmChainId={evmChainId} address={address} abi={abi} />}
        {tab === "write" && (
          <div>
            <p className="mb-4 text-xs text-bone-dim/40">Connect a browser wallet to send a real transaction.</p>
            <ContractWritePanel
              evmChainId={evmChainId}
              address={address}
              abi={abi}
              chainName={chainName}
              chainSymbol={chainSymbol}
              rpcUrl={gatewayRpcUrl}
            />
          </div>
        )}
      </div>
    </div>
  );
}
