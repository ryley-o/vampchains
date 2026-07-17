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
      <p className="rounded-xl border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
        Contracts aren&apos;t deployed/configured on this environment yet. See docs/DEPLOYMENT.md.
      </p>
    );
  }

  return (
    <div className="space-y-7">
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-bone-dim/60">
          Existing ERC20 token address
        </label>
        <input
          value={tokenAddress}
          onChange={(e) => setTokenAddress(e.target.value.trim())}
          placeholder="0x..."
          className="mt-2 w-full rounded-xl border border-hairline bg-ink-raised px-4 py-3 font-mono text-sm text-bone placeholder:text-bone-dim/30 focus:border-blood/60"
        />
        {tokenAddress && !validToken && <p className="mt-1.5 text-xs text-blood-bright">Not a valid address.</p>}
        {validToken && tokenDecimalsError && (
          <p className="mt-1.5 text-xs text-blood-bright">
            Couldn&apos;t read decimals() from this address — is it really an ERC20?
          </p>
        )}
        {tokenAlreadyUsed && (
          <p className="mt-1.5 text-xs text-blood-bright">This token already has an active vampchain.</p>
        )}
        {validToken && tokenDecimals !== undefined && !tokenDecimalsError && (
          <p className="mt-1.5 text-xs text-emerald-300/80">
            Detected: {String(tokenName ?? "?")} (${String(tokenSymbol ?? "?")}), {String(tokenDecimals)} decimals
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-bone-dim/60">
            Chain name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
            className="mt-2 w-full rounded-xl border border-hairline bg-ink-raised px-4 py-3 text-sm text-bone focus:border-blood/60"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-bone-dim/60">Symbol</label>
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            maxLength={16}
            className="mt-2 w-full rounded-xl border border-hairline bg-ink-raised px-4 py-3 text-sm text-bone focus:border-blood/60"
          />
        </div>
      </div>

      <div className="rounded-xl border border-hairline bg-charcoal-soft/50 p-4 text-sm text-bone-dim/80">
        <p>
          Annual fee: <span className="font-semibold text-bone">${formatUsdc(fee)} USDC</span>, paid up front and
          drawn down linearly over the year — nobody can charge you for runway you haven&apos;t
          used yet. See{" "}
          <a href="/terms" className="text-bone underline underline-offset-2">
            terms
          </a>
          .
        </p>
      </div>

      <label className="flex items-start gap-2.5 text-sm text-bone-dim/60">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-1 accent-blood"
        />
        <span>
          I&apos;ve read the{" "}
          <a href="/terms" className="text-bone-dim underline underline-offset-2">
            terms
          </a>
          : this is unaudited, experimental software, the bridge is a single trusted relayer, and
          I won&apos;t use it for anything illegal.
        </span>
      </label>

      {!isConnected ? (
        <p className="text-sm text-bone-dim/50">Connect your wallet to continue.</p>
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
          className="w-full rounded-full bg-bone px-6 py-3.5 text-sm font-semibold uppercase tracking-wider text-ink transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 sm:w-auto"
        >
          {approving || approveConfirming ? "Approving USDC…" : `Approve ${formatUsdc(fee)} USDC`}
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
          className="w-full rounded-full bg-blood px-6 py-3.5 text-sm font-semibold uppercase tracking-wider text-bone shadow-[0_0_40px_rgba(226,45,58,0.3)] transition-transform hover:scale-[1.02] hover:bg-blood-bright disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 sm:w-auto"
        >
          {creating || createConfirming ? "Creating chain…" : "Pay & create vampchain"}
        </button>
      )}

      {createError && <p className="text-sm text-blood-bright">{createError.message}</p>}
      {createConfirmed && (
        <p className="text-sm text-emerald-300">
          Chain created! It&apos;ll show up on the homepage once the provisioner spins up its node
          — usually well under a minute.
        </p>
      )}
    </div>
  );
}
