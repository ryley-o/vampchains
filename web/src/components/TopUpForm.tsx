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
      <p className="text-xs text-neutral-500">
        Anyone can send USDC here to extend this chain&apos;s runway — the public way to prevent a
        chain from getting torn down.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount (USDC)"
          className="w-40 rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
        {!isConnected ? (
          <span className="self-center text-sm text-neutral-500">Connect wallet</span>
        ) : needsApproval ? (
          <button
            disabled={!parsedAmount || approving || approveConfirming}
            onClick={() =>
              parsedAmount &&
              approve({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "approve", args: [REGISTRY_ADDRESS, parsedAmount] })
            }
            className="rounded bg-neutral-100 px-4 py-2 text-sm font-medium text-black hover:bg-white disabled:opacity-50"
          >
            {approving || approveConfirming ? "Approving..." : "Approve"}
          </button>
        ) : (
          <button
            disabled={!parsedAmount || sending || confirming}
            onClick={() => parsedAmount && topUp({ address: REGISTRY_ADDRESS, abi: REGISTRY_ABI, functionName: "topUp", args: [chainId, parsedAmount] })}
            className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
          >
            {sending || confirming ? "Sending..." : "Top up"}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error.message}</p>}
      {confirmed && <p className="mt-2 text-sm text-green-400">Topped up!</p>}
    </div>
  );
}
