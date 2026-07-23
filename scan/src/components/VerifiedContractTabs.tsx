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
///
/// Also reused for the two genesis contracts and every wrapped-token clone
/// — those don't have a `VerifiedContract` DB row (no community submission
/// involved, they're recognized for free by bytecode pattern-match), but
/// their real ABI is baked into `@vampchains/contract-abis` and their
/// source is a fixed, known file in this repo, so read/write access to
/// them shouldn't be second-class next to a community-verified contract's.
/// Pass `githubUrl` instead of `sources` for that case.
export function VerifiedContractTabs({
  evmChainId,
  address,
  abi,
  sources,
  githubUrl,
  chainName,
  chainSymbol,
  gatewayRpcUrl,
}: {
  evmChainId: string;
  address: `0x${string}`;
  abi: unknown[];
  sources: StandardJsonSources[] | null;
  githubUrl?: string;
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
        {tab === "source" &&
          (sources ? (
            <SourceCodeViewer sources={sources} />
          ) : githubUrl ? (
            <a href={githubUrl} className="text-xs text-blood underline underline-offset-2 hover:text-blood-bright">
              View source on GitHub →
            </a>
          ) : (
            <p className="text-xs text-bone-dim/40">No source recorded.</p>
          ))}
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
