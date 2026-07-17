"use client";

import { useEffect, useMemo, useState } from "react";
import { type Address, isAddress } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { REGISTRY_ABI, REGISTRY_ADDRESS, USDC_ADDRESS, CONTRACTS_CONFIGURED } from "@/lib/contracts";
import { ERC20_ABI } from "@/lib/erc20Abi";
import { formatUsdc } from "@/lib/format";

export function CreateChainForm() {
  const { address, isConnected } = useAccount();

  const [tokenAddress, setTokenAddress] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [agreed, setAgreed] = useState(false);

  const validToken = isAddress(tokenAddress) ? (tokenAddress as Address) : undefined;

  const { data: tokenName } = useReadContract({
    address: validToken,
    abi: ERC20_ABI,
    functionName: "name",
    query: { enabled: !!validToken },
  });
  const { data: tokenSymbol } = useReadContract({
    address: validToken,
    abi: ERC20_ABI,
    functionName: "symbol",
    query: { enabled: !!validToken },
  });
  const { data: tokenDecimals, isError: tokenDecimalsError } = useReadContract({
    address: validToken,
    abi: ERC20_ABI,
    functionName: "decimals",
    query: { enabled: !!validToken },
  });

  const { data: annualFee } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: REGISTRY_ABI,
    functionName: "defaultAnnualFeeUSDC",
    query: { enabled: CONTRACTS_CONFIGURED },
  });

  const { data: activeChainForToken } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: REGISTRY_ABI,
    functionName: "activeChainByToken",
    args: validToken ? [validToken] : undefined,
    query: { enabled: !!validToken && CONTRACTS_CONFIGURED },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, REGISTRY_ADDRESS] : undefined,
    query: { enabled: !!address && CONTRACTS_CONFIGURED },
  });

  const fee = (annualFee as bigint | undefined) ?? 0n;
  const needsApproval = (allowance as bigint | undefined) === undefined || (allowance as bigint) < fee;
  const tokenAlreadyUsed = !!activeChainForToken && (activeChainForToken as bigint) !== 0n;

  const { writeContract: approve, data: approveHash, isPending: approving } = useWriteContract();
  const { isLoading: approveConfirming, isSuccess: approveConfirmed } = useWaitForTransactionReceipt({
    hash: approveHash,
  });

  const { writeContract: createChain, data: createHash, isPending: creating, error: createError } = useWriteContract();
  const { isLoading: createConfirming, isSuccess: createConfirmed } = useWaitForTransactionReceipt({
    hash: createHash,
  });

  useEffect(() => {
    if (approveConfirmed) refetchAllowance();
  }, [approveConfirmed, refetchAllowance]);

  const canSubmit = useMemo(
    () =>
      CONTRACTS_CONFIGURED &&
      isConnected &&
      !!validToken &&
      !tokenDecimalsError &&
      !tokenAlreadyUsed &&
      name.trim().length > 0 &&
      name.length <= 64 &&
      symbol.trim().length > 0 &&
      symbol.length <= 16 &&
      agreed,
    [isConnected, validToken, tokenDecimalsError, tokenAlreadyUsed, name, symbol, agreed]
  );

  if (!CONTRACTS_CONFIGURED) {
    return (
      <p className="rounded border border-yellow-700 bg-yellow-950/40 px-4 py-3 text-sm text-yellow-300">
        Contracts aren&apos;t deployed/configured on this environment yet. See docs/DEPLOYMENT.md.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-neutral-300">Existing ERC20 token address</label>
        <input
          value={tokenAddress}
          onChange={(e) => setTokenAddress(e.target.value.trim())}
          placeholder="0x..."
          className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-sm"
        />
        {tokenAddress && !validToken && <p className="mt-1 text-xs text-red-400">Not a valid address.</p>}
        {validToken && tokenDecimalsError && (
          <p className="mt-1 text-xs text-red-400">
            Couldn&apos;t read decimals() from this address — is it really an ERC20?
          </p>
        )}
        {tokenAlreadyUsed && (
          <p className="mt-1 text-xs text-red-400">This token already has an active vampchain.</p>
        )}
        {validToken && tokenDecimals !== undefined && !tokenDecimalsError && (
          <p className="mt-1 text-xs text-neutral-500">
            Detected: {String(tokenName ?? "?")} (${String(tokenSymbol ?? "?")}), {String(tokenDecimals)} decimals
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-neutral-300">Chain name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
            className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-300">Symbol</label>
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            maxLength={16}
            className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="rounded border border-neutral-800 bg-neutral-900/50 p-4 text-sm">
        <p>
          Annual fee: <span className="font-semibold">${formatUsdc(fee)} USDC</span> (paid up front, drawn down
          linearly over the year, refundable runway if you never touch it again — see{" "}
          <a href="/terms" className="underline">
            terms
          </a>
          ).
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm text-neutral-400">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1" />
        <span>
          I&apos;ve read the <a href="/terms" className="underline">terms</a>: this is unaudited, experimental
          software, the bridge is a single trusted relayer, and I won&apos;t use it for anything illegal.
        </span>
      </label>

      {!isConnected ? (
        <p className="text-sm text-neutral-500">Connect your wallet to continue.</p>
      ) : needsApproval ? (
        <button
          disabled={!canSubmit || approving || approveConfirming}
          onClick={() =>
            approve({
              address: USDC_ADDRESS,
              abi: ERC20_ABI,
              functionName: "approve",
              args: [REGISTRY_ADDRESS, fee],
            })
          }
          className="rounded bg-neutral-100 px-4 py-2 text-sm font-medium text-black hover:bg-white disabled:opacity-50"
        >
          {approving || approveConfirming ? "Approving USDC..." : `Approve ${formatUsdc(fee)} USDC`}
        </button>
      ) : (
        <button
          disabled={!canSubmit || creating || createConfirming}
          onClick={() =>
            validToken &&
            createChain({
              address: REGISTRY_ADDRESS,
              abi: REGISTRY_ABI,
              functionName: "createChain",
              args: [validToken, name, symbol],
            })
          }
          className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
        >
          {creating || createConfirming ? "Creating chain..." : "Pay & create vampchain"}
        </button>
      )}

      {createError && <p className="text-sm text-red-400">{createError.message}</p>}
      {createConfirmed && (
        <p className="text-sm text-green-400">
          Chain created! It&apos;ll show up on the homepage once the provisioner spins up its node
          (usually well under a minute).
        </p>
      )}
    </div>
  );
}
