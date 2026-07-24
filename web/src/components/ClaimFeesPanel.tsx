"use client";

import { type Address, decodeEventLog, formatUnits, getAddress } from "viem";
import { useAccount, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { BRIDGE_ABI } from "@/lib/contracts";
import { formatTokenAmount } from "@/lib/format";

interface SplitAmounts {
  toProtocol: bigint;
  toCreator: bigint;
  toRunway: bigint;
}

// Narrow `as const` event fragment purely for typed decoding below — the
// JSON-imported BRIDGE_ABI itself isn't literal-typed, so viem can't infer
// named args from it directly (falls back to `readonly unknown[]`).
const FEE_REVENUE_CLAIMED_EVENT = {
  type: "event",
  name: "FeeRevenueClaimed",
  inputs: [
    { name: "chainId", type: "uint256", indexed: true },
    { name: "toProtocol", type: "uint256", indexed: false },
    { name: "toCreator", type: "uint256", indexed: false },
    { name: "toRunway", type: "uint256", indexed: false },
    { name: "cumulativeRevenue", type: "uint256", indexed: false },
    { name: "asOfBlock", type: "uint256", indexed: false },
  ],
} as const;

interface OutstandingFeeRevenue {
  cumulativeRevenue: bigint;
  asOfBlock: bigint;
  signature: `0x${string}`;
  outstandingAmount: bigint;
  tipsNativeWei: bigint;
  baseFeeNativeWei: bigint;
}

interface ClaimFeesPanelProps {
  creator: Address;
  protocolTreasury: Address | null;
  runwayTreasury: Address | null;
  homeChainId: number;
  bridgeAddress: Address;
  chainId: bigint;
  baseTokenSymbol: string;
  baseTokenDecimals: number;
  outstanding: OutstandingFeeRevenue | null;
}

/// Buried by design: renders nothing at all unless the connected wallet is
/// one of the three parties the fee split actually pays out to (creator,
/// protocol treasury, runway treasury). Discoverability gate, not a
/// security boundary — claimFeeRevenue is permissionless on-chain
/// regardless of who calls it (no caller-supplied recipient, see
/// docs/ARCHITECTURE.md "Protocol fee revenue").
export function ClaimFeesPanel({
  creator,
  protocolTreasury,
  runwayTreasury,
  homeChainId,
  bridgeAddress,
  chainId,
  baseTokenSymbol,
  baseTokenDecimals,
  outstanding,
}: ClaimFeesPanelProps) {
  const { address } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { data: receipt, isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({ hash });

  const privileged =
    !!address &&
    [creator, protocolTreasury, runwayTreasury]
      .filter((a): a is Address => !!a)
      .some((a) => getAddress(a) === getAddress(address));

  if (!privileged) return null;

  let split: SplitAmounts | null = null;
  if (confirmed && receipt) {
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: [FEE_REVENUE_CLAIMED_EVENT], data: log.data, topics: log.topics });
        split = { toProtocol: decoded.args.toProtocol, toCreator: decoded.args.toCreator, toRunway: decoded.args.toRunway };
        break;
      } catch {
        // not this log — every tx has other logs (Transfer x3) mixed in
      }
    }
  }

  return (
    <section className="rounded-2xl border border-hairline bg-ink-raised p-6 sm:p-8">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-blood">Privileged</p>
      <h2 className="text-display mt-1.5 text-2xl text-bone">Claim protocol revenue</h2>
      <p className="mt-2 text-sm text-bone-dim/60">
        You&apos;re connected as this chain&apos;s creator, or hold the protocol/runway treasury — only visible to
        you.
      </p>
      <div className="mt-5">
        {!outstanding ? (
          <p className="text-sm text-bone-dim/50">Nothing to claim right now.</p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-ink px-4 py-3">
            <div>
              <p className="text-sm text-bone">
                {formatTokenAmount(outstanding.outstandingAmount, baseTokenDecimals)}{" "}
                <span className="text-bone-dim/50">${baseTokenSymbol}</span> available
              </p>
              <p className="mt-0.5 font-mono text-xs text-bone-dim/40">
                {formatUnits(outstanding.tipsNativeWei, 18)} tips + {formatUnits(outstanding.baseFeeNativeWei, 18)} base
                fee, all-time · one transaction claims it all
              </p>
            </div>
            <button
              disabled={isPending || confirming}
              onClick={async () => {
                await switchChainAsync({ chainId: homeChainId });
                writeContract({
                  address: bridgeAddress,
                  abi: BRIDGE_ABI,
                  functionName: "claimFeeRevenue",
                  args: [chainId, outstanding.cumulativeRevenue, outstanding.asOfBlock, outstanding.signature],
                });
              }}
              className="rounded-lg bg-blood px-3 py-1.5 text-xs font-semibold text-bone transition-colors hover:bg-blood-bright disabled:opacity-40"
            >
              {isPending || confirming ? "Claiming…" : "Claim"}
            </button>
            {error && <p className="w-full font-mono text-xs text-blood-bright">{error.message}</p>}
            {split && (
              <p className="w-full text-xs text-emerald-300">
                Claimed — split {formatTokenAmount(split.toCreator, baseTokenDecimals)} to creator,{" "}
                {formatTokenAmount(split.toProtocol, baseTokenDecimals)} to protocol,{" "}
                {formatTokenAmount(split.toRunway, baseTokenDecimals)} to runway (${baseTokenSymbol}).
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
