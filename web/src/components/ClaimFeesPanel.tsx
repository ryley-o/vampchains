"use client";

import { useState } from "react";
import { type Address, decodeEventLog, getAddress } from "viem";
import { useAccount, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { BRIDGE_ABI } from "@/lib/contracts";
import { formatTokenAmount } from "@/lib/format";
import { getHomePublicClient } from "@/lib/viemClients";

interface SplitAmounts {
  toProtocol: bigint;
  toCreator: bigint;
  toRunway: bigint;
}

// Narrow `as const` event fragments purely for typed decoding below — the
// JSON-imported BRIDGE_ABI itself isn't literal-typed, so viem can't infer
// named args from it directly (falls back to `readonly unknown[]`).
const BURNED_FEES_CLAIMED_EVENT = {
  type: "event",
  name: "BurnedFeesClaimed",
  inputs: [
    { name: "chainId", type: "uint256", indexed: true },
    { name: "toProtocol", type: "uint256", indexed: false },
    { name: "toCreator", type: "uint256", indexed: false },
    { name: "toRunway", type: "uint256", indexed: false },
    { name: "cumulativeBurned", type: "uint256", indexed: false },
    { name: "asOfBlock", type: "uint256", indexed: false },
  ],
} as const;

const SWEPT_CLAIMED_EVENT = {
  type: "event",
  name: "SweptClaimed",
  inputs: [
    { name: "chainId", type: "uint256", indexed: true },
    { name: "toProtocol", type: "uint256", indexed: false },
    { name: "toCreator", type: "uint256", indexed: false },
    { name: "toRunway", type: "uint256", indexed: false },
    { name: "sidechainTxHash", type: "bytes32", indexed: true },
  ],
} as const;

function SplitConfirmation({ split, decimals, symbol }: { split: SplitAmounts; decimals: number; symbol: string }) {
  return (
    <p className="mt-2 text-xs text-emerald-300">
      Claimed — split {formatTokenAmount(split.toCreator, decimals)} to creator,{" "}
      {formatTokenAmount(split.toProtocol, decimals)} to protocol,{" "}
      {formatTokenAmount(split.toRunway, decimals)} to runway (${symbol}).
    </p>
  );
}

interface OutstandingBurnedFees {
  cumulativeBurned: bigint;
  asOfBlock: bigint;
  signature: `0x${string}`;
  outstandingAmount: bigint;
}

interface OutstandingSweepClaim {
  sidechainTxHash: `0x${string}`;
  amount: bigint;
  signature: `0x${string}`;
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
  outstandingBurnedFees: OutstandingBurnedFees | null;
  outstandingSweepClaims: OutstandingSweepClaim[];
}

function BurnedFeesRow({
  outstanding,
  homeChainId,
  bridgeAddress,
  chainId,
  baseTokenSymbol,
  baseTokenDecimals,
}: {
  outstanding: OutstandingBurnedFees;
  homeChainId: number;
  bridgeAddress: Address;
  chainId: bigint;
  baseTokenSymbol: string;
  baseTokenDecimals: number;
}) {
  const { switchChainAsync } = useSwitchChain();
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { data: receipt, isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({ hash });

  let split: SplitAmounts | null = null;
  if (confirmed && receipt) {
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: [BURNED_FEES_CLAIMED_EVENT], data: log.data, topics: log.topics });
        split = { toProtocol: decoded.args.toProtocol, toCreator: decoded.args.toCreator, toRunway: decoded.args.toRunway };
        break;
      } catch {
        // not this log — every tx has other logs (Transfer x3) mixed in
      }
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-ink-raised px-4 py-3">
      <div>
        <p className="text-sm text-bone">Base-fee revenue</p>
        <p className="mt-0.5 font-mono text-xs text-bone-dim/50">
          {formatTokenAmount(outstanding.outstandingAmount, baseTokenDecimals)} ${baseTokenSymbol} available
        </p>
      </div>
      <button
        disabled={isPending || confirming}
        onClick={async () => {
          await switchChainAsync({ chainId: homeChainId });
          writeContract({
            address: bridgeAddress,
            abi: BRIDGE_ABI,
            functionName: "claimBurnedFees",
            args: [chainId, outstanding.cumulativeBurned, outstanding.asOfBlock, outstanding.signature],
          });
        }}
        className="rounded-lg bg-blood px-3 py-1.5 text-xs font-semibold text-bone transition-colors hover:bg-blood-bright disabled:opacity-40"
      >
        {isPending || confirming ? "Claiming…" : "Claim"}
      </button>
      {error && <p className="w-full font-mono text-xs text-blood-bright">{error.message}</p>}
      {split && <SplitConfirmation split={split} decimals={baseTokenDecimals} symbol={baseTokenSymbol} />}
    </div>
  );
}

type SweepStatus = "idle" | "pending" | "confirming" | "done" | "failed";

function SweepClaimsRow({
  claims,
  homeChainId,
  bridgeAddress,
  chainId,
  baseTokenSymbol,
  baseTokenDecimals,
}: {
  claims: OutstandingSweepClaim[];
  homeChainId: number;
  bridgeAddress: Address;
  chainId: bigint;
  baseTokenSymbol: string;
  baseTokenDecimals: number;
}) {
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [statuses, setStatuses] = useState<Record<string, SweepStatus>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [lastSplit, setLastSplit] = useState<SplitAmounts | null>(null);

  const totalOutstanding = claims.reduce((sum, c) => sum + c.amount, 0n);
  const doneCount = Object.values(statuses).filter((s) => s === "done").length;

  async function claimAll() {
    setRunning(true);
    setLastSplit(null);
    await switchChainAsync({ chainId: homeChainId });

    // Sequential, not parallel — these all come from the same wallet, so
    // firing them concurrently risks nonce collisions. Each sweep claim is
    // independent, so one failing doesn't block the rest from being tried.
    for (const claim of claims) {
      setStatuses((s) => ({ ...s, [claim.sidechainTxHash]: "pending" }));
      try {
        const hash = await writeContractAsync({
          address: bridgeAddress,
          abi: BRIDGE_ABI,
          functionName: "claimSwept",
          args: [chainId, claim.amount, claim.sidechainTxHash, claim.signature],
        });
        setStatuses((s) => ({ ...s, [claim.sidechainTxHash]: "confirming" }));
        const receipt = await waitForReceipt(hash);
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({ abi: [SWEPT_CLAIMED_EVENT], data: log.data, topics: log.topics });
            setLastSplit({ toProtocol: decoded.args.toProtocol, toCreator: decoded.args.toCreator, toRunway: decoded.args.toRunway });
            break;
          } catch {
            // not this log
          }
        }
        setStatuses((s) => ({ ...s, [claim.sidechainTxHash]: "done" }));
      } catch (err) {
        setStatuses((s) => ({ ...s, [claim.sidechainTxHash]: "failed" }));
        setErrors((e) => ({ ...e, [claim.sidechainTxHash]: err instanceof Error ? err.message : "claim failed" }));
      }
    }
    setRunning(false);
  }

  // Manual receipt-wait rather than the useWaitForTransactionReceipt hook —
  // that hook can't be called in a loop, and this batch is inherently
  // sequential (see claimAll above).
  function waitForReceipt(hash: `0x${string}`) {
    return getHomePublicClient(homeChainId).waitForTransactionReceipt({ hash });
  }

  return (
    <div className="rounded-xl border border-hairline bg-ink-raised px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-bone">Tip revenue</p>
          <p className="mt-0.5 font-mono text-xs text-bone-dim/50">
            {claims.length} sweep{claims.length === 1 ? "" : "s"} pending ·{" "}
            {formatTokenAmount(totalOutstanding, baseTokenDecimals)} ${baseTokenSymbol} total
          </p>
        </div>
        <button
          disabled={running}
          onClick={claimAll}
          className="rounded-lg bg-blood px-3 py-1.5 text-xs font-semibold text-bone transition-colors hover:bg-blood-bright disabled:opacity-40"
        >
          {running ? `Claiming (${doneCount}/${claims.length})…` : `Claim all (${claims.length})`}
        </button>
      </div>
      {running && (
        <div className="mt-3 space-y-1">
          {claims.map((claim) => (
            <div key={claim.sidechainTxHash} className="flex items-center justify-between font-mono text-xs text-bone-dim/50">
              <span>{claim.sidechainTxHash.slice(0, 10)}…</span>
              <span
                className={
                  statuses[claim.sidechainTxHash] === "done"
                    ? "text-emerald-300"
                    : statuses[claim.sidechainTxHash] === "failed"
                      ? "text-blood-bright"
                      : "text-amber-300"
                }
              >
                {statuses[claim.sidechainTxHash] ?? "waiting"}
              </span>
            </div>
          ))}
        </div>
      )}
      {Object.entries(errors).map(([hash, message]) => (
        <p key={hash} className="mt-1 font-mono text-xs text-blood-bright">
          {hash.slice(0, 10)}…: {message}
        </p>
      ))}
      {lastSplit && <SplitConfirmation split={lastSplit} decimals={baseTokenDecimals} symbol={baseTokenSymbol} />}
    </div>
  );
}

/// Buried by design: renders nothing at all unless the connected wallet is
/// one of the three parties the fee split actually pays out to (creator,
/// protocol treasury, runway treasury). This is a discoverability gate,
/// not a security boundary — claimSwept/claimBurnedFees are permissionless
/// on-chain regardless of who calls them (no caller-supplied recipient,
/// see docs/ARCHITECTURE.md "Protocol fee revenue"), so nothing here is
/// actually restricting who *could* claim, only who sees a reason to.
export function ClaimFeesPanel({
  creator,
  protocolTreasury,
  runwayTreasury,
  homeChainId,
  bridgeAddress,
  chainId,
  baseTokenSymbol,
  baseTokenDecimals,
  outstandingBurnedFees,
  outstandingSweepClaims,
}: ClaimFeesPanelProps) {
  const { address } = useAccount();

  const privileged =
    !!address &&
    [creator, protocolTreasury, runwayTreasury]
      .filter((a): a is Address => !!a)
      .some((a) => getAddress(a) === getAddress(address));

  if (!privileged) return null;

  const nothingOutstanding = !outstandingBurnedFees && outstandingSweepClaims.length === 0;

  return (
    <section className="rounded-2xl border border-hairline bg-ink-raised p-6 sm:p-8">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-blood">Privileged</p>
      <h2 className="text-display mt-1.5 text-2xl text-bone">Claim protocol revenue</h2>
      <p className="mt-2 text-sm text-bone-dim/60">
        You&apos;re connected as this chain&apos;s creator, or hold the protocol/runway treasury — only visible to
        you.
      </p>
      <div className="mt-5 space-y-3">
        {nothingOutstanding && <p className="text-sm text-bone-dim/50">Nothing to claim right now.</p>}
        {outstandingBurnedFees && (
          <BurnedFeesRow
            outstanding={outstandingBurnedFees}
            homeChainId={homeChainId}
            bridgeAddress={bridgeAddress}
            chainId={chainId}
            baseTokenSymbol={baseTokenSymbol}
            baseTokenDecimals={baseTokenDecimals}
          />
        )}
        {outstandingSweepClaims.length > 0 && (
          <SweepClaimsRow
            claims={outstandingSweepClaims}
            homeChainId={homeChainId}
            bridgeAddress={bridgeAddress}
            chainId={chainId}
            baseTokenSymbol={baseTokenSymbol}
            baseTokenDecimals={baseTokenDecimals}
          />
        )}
      </div>
    </section>
  );
}
