"use client";

import { useState } from "react";
import { parseUnits } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { REGISTRY_ABI, REGISTRY_ADDRESS, USDC_ADDRESS, USDC_DECIMALS } from "@/lib/contracts";
import { ERC20_ABI } from "@/lib/erc20Abi";

export function TopUpForm({ chainId }: { chainId: bigint }) {
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState("");

  let parsedAmount: bigint | undefined;
  try {
    parsedAmount = amount ? parseUnits(amount, USDC_DECIMALS) : undefined;
  } catch {
    parsedAmount = undefined;
  }

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, REGISTRY_ADDRESS] : undefined,
    query: { enabled: !!address },
  });

  const needsApproval = parsedAmount !== undefined && ((allowance as bigint | undefined) ?? 0n) < parsedAmount;

  const { writeContract: approve, data: approveHash, isPending: approving } = useWriteContract();
  const { isLoading: approveConfirming, isSuccess: approveConfirmed } = useWaitForTransactionReceipt({
    hash: approveHash,
  });
  if (approveConfirmed) refetchAllowance();

  const { writeContract: topUp, data: topUpHash, isPending: sending, error } = useWriteContract();
  const { isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: topUpHash });

  return (
    <div>
      <p className="text-xs text-bone-dim/50">
        Anyone can send USDC here to extend this chain&apos;s runway — the public way to keep a
        chain from flatlining.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount (USDC)"
          className="w-40 rounded-xl border border-hairline bg-ink-raised px-3 py-2 text-sm text-bone placeholder:text-bone-dim/30 focus:border-blood/60"
        />
        {!isConnected ? (
          <span className="self-center text-sm text-bone-dim/40">Connect wallet</span>
        ) : needsApproval ? (
          <button
            disabled={!parsedAmount || approving || approveConfirming}
            onClick={() =>
              parsedAmount &&
              approve({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "approve", args: [REGISTRY_ADDRESS, parsedAmount] })
            }
            className="rounded-xl bg-bone px-4 py-2 text-sm font-semibold text-ink transition-transform hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100"
          >
            {approving || approveConfirming ? "Approving…" : "Approve"}
          </button>
        ) : (
          <button
            disabled={!parsedAmount || sending || confirming}
            onClick={() => parsedAmount && topUp({ address: REGISTRY_ADDRESS, abi: REGISTRY_ABI, functionName: "topUp", args: [chainId, parsedAmount] })}
            className="rounded-xl bg-blood px-4 py-2 text-sm font-semibold text-bone transition-transform hover:scale-[1.03] hover:bg-blood-bright disabled:opacity-40 disabled:hover:scale-100"
          >
            {sending || confirming ? "Sending…" : "Top up"}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-blood-bright">{error.message}</p>}
      {confirmed && <p className="mt-2 text-sm text-emerald-300">Topped up!</p>}
    </div>
  );
}
