"use client";

import { useState } from "react";
import { type Address, isAddress, parseUnits } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { BRIDGE_ADDRESS, BRIDGE_ABI, BURN_ADDRESS } from "@/lib/contracts";
import { ERC20_ABI } from "@/lib/erc20Abi";

interface BridgeFormProps {
  chainId: bigint;
  baseToken: Address;
  baseTokenSymbol: string;
  baseTokenDecimals: number;
  evmChainId: bigint;
  gatewayRpcUrl: string;
}

export function BridgeForm({
  chainId,
  baseToken,
  baseTokenSymbol,
  baseTokenDecimals,
  evmChainId,
  gatewayRpcUrl,
}: BridgeFormProps) {
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");

  const effectiveRecipient = isAddress(recipient) ? (recipient as Address) : address;

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: baseToken,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, BRIDGE_ADDRESS] : undefined,
    query: { enabled: !!address },
  });

  let parsedAmount: bigint | undefined;
  try {
    parsedAmount = amount ? parseUnits(amount, baseTokenDecimals) : undefined;
  } catch {
    parsedAmount = undefined;
  }

  const needsApproval = parsedAmount !== undefined && ((allowance as bigint | undefined) ?? 0n) < parsedAmount;

  const { writeContract: approve, data: approveHash, isPending: approving } = useWriteContract();
  const { isLoading: approveConfirming, isSuccess: approveConfirmed } = useWaitForTransactionReceipt({
    hash: approveHash,
  });
  if (approveConfirmed) refetchAllowance();

  const { writeContract: deposit, data: depositHash, isPending: depositing, error: depositError } = useWriteContract();
  const { isLoading: depositConfirming, isSuccess: depositConfirmed } = useWaitForTransactionReceipt({
    hash: depositHash,
  });

  async function addToWallet() {
    const eth = (window as unknown as { ethereum?: { request: (args: unknown) => Promise<unknown> } }).ethereum;
    if (!eth) return;
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: `0x${evmChainId.toString(16)}`,
          chainName: `vampchain-${chainId}`,
          nativeCurrency: { name: baseTokenSymbol, symbol: baseTokenSymbol, decimals: 18 },
          rpcUrls: [gatewayRpcUrl],
        },
      ],
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold">Deposit → mint native currency on the vampchain</h3>
        <p className="mt-1 text-xs text-neutral-500">
          Locks {baseTokenSymbol} here on the home chain; the relayer mints you the equivalent
          native balance on the vampchain, usually within a few seconds.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`Amount (${baseTokenSymbol})`}
            className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          />
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Recipient (defaults to you)"
            className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-sm"
          />
        </div>

        {!isConnected ? (
          <p className="mt-3 text-sm text-neutral-500">Connect your wallet to bridge.</p>
        ) : needsApproval ? (
          <button
            disabled={!parsedAmount || approving || approveConfirming}
            onClick={() =>
              parsedAmount &&
              approve({ address: baseToken, abi: ERC20_ABI, functionName: "approve", args: [BRIDGE_ADDRESS, parsedAmount] })
            }
            className="mt-3 rounded bg-neutral-100 px-4 py-2 text-sm font-medium text-black hover:bg-white disabled:opacity-50"
          >
            {approving || approveConfirming ? "Approving..." : `Approve ${baseTokenSymbol}`}
          </button>
        ) : (
          <button
            disabled={!parsedAmount || !effectiveRecipient || depositing || depositConfirming}
            onClick={() =>
              parsedAmount &&
              effectiveRecipient &&
              deposit({
                address: BRIDGE_ADDRESS,
                abi: BRIDGE_ABI,
                functionName: "deposit",
                args: [chainId, parsedAmount, effectiveRecipient],
              })
            }
            className="mt-3 rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
          >
            {depositing || depositConfirming ? "Depositing..." : "Deposit & mint"}
          </button>
        )}
        {depositError && <p className="mt-2 text-sm text-red-400">{depositError.message}</p>}
        {depositConfirmed && <p className="mt-2 text-sm text-green-400">Deposited — mint should land shortly.</p>}
      </div>

      <div className="border-t border-neutral-800 pt-6">
        <h3 className="font-semibold">Withdraw → back to {baseTokenSymbol} on the home chain</h3>
        <p className="mt-1 text-xs text-neutral-500">
          Add the vampchain to your wallet, switch to it, then send native currency to the burn
          address <code className="font-mono">{BURN_ADDRESS}</code>. The relayer watches for that
          and releases the equivalent {baseTokenSymbol} back to you here.
        </p>
        <button
          onClick={addToWallet}
          className="mt-3 rounded border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-800"
        >
          Add vampchain to wallet
        </button>
      </div>
    </div>
  );
}
