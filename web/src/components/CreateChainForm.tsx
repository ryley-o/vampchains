"use client";

import { useEffect, useMemo, useState } from "react";
import { type Address, isAddress } from "viem";
import { useAccount, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { REGISTRY_ABI, HOME_CHAIN_WEB_CONFIGS, CONTRACTS_CONFIGURED } from "@/lib/contracts";
import { ERC20_ABI } from "@/lib/erc20Abi";
import { formatUsdc } from "@/lib/format";
import { TokenLogo } from "@/components/TokenLogo";

// Mirrors VampChainRegistry's MIN_LABEL_LEN/MAX_NAME_LEN/MAX_SYMBOL_LEN — the
// vampchain's name/symbol are derived straight from the token's own
// name()/symbol(), clamped so a token with an unusually long name can't
// make the on-chain call revert.
const MAX_NAME_LEN = 64;
const MAX_SYMBOL_LEN = 16;

export function CreateChainForm() {
  const { address, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  const [homeChainId, setHomeChainId] = useState(
    HOME_CHAIN_WEB_CONFIGS.find((c) => c.configured)?.homeChainId ?? HOME_CHAIN_WEB_CONFIGS[0].homeChainId
  );
  const homeChain = HOME_CHAIN_WEB_CONFIGS.find((c) => c.homeChainId === homeChainId) ?? HOME_CHAIN_WEB_CONFIGS[0];
  const REGISTRY_ADDRESS = homeChain.registryAddress;
  const USDC_ADDRESS = homeChain.usdcAddress;

  const [tokenAddress, setTokenAddress] = useState("");
  const [agreed, setAgreed] = useState(false);

  const validToken = isAddress(tokenAddress) ? (tokenAddress as Address) : undefined;

  const { data: tokenName, isError: tokenNameError } = useReadContract({
    address: validToken,
    abi: ERC20_ABI,
    functionName: "name",
    chainId: homeChainId,
    query: { enabled: !!validToken },
  });
  const { data: tokenSymbol, isError: tokenSymbolError } = useReadContract({
    address: validToken,
    abi: ERC20_ABI,
    functionName: "symbol",
    chainId: homeChainId,
    query: { enabled: !!validToken },
  });
  const { data: tokenDecimals, isError: tokenDecimalsError } = useReadContract({
    address: validToken,
    abi: ERC20_ABI,
    functionName: "decimals",
    chainId: homeChainId,
    query: { enabled: !!validToken },
  });

  const derivedName = typeof tokenName === "string" && tokenName.length > 0 ? tokenName.slice(0, MAX_NAME_LEN) : undefined;
  const derivedSymbol =
    typeof tokenSymbol === "string" && tokenSymbol.length > 0 ? tokenSymbol.slice(0, MAX_SYMBOL_LEN) : undefined;
  const metadataUnreadable = !!validToken && (tokenNameError || tokenSymbolError);

  const { data: annualFee } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: REGISTRY_ABI,
    functionName: "defaultAnnualFeeUSDC",
    chainId: homeChainId,
    query: { enabled: homeChain.configured },
  });

  const { data: activeChainForToken } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: REGISTRY_ABI,
    functionName: "activeChainByToken",
    args: validToken ? [validToken] : undefined,
    chainId: homeChainId,
    query: { enabled: !!validToken && homeChain.configured },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, REGISTRY_ADDRESS] : undefined,
    chainId: homeChainId,
    query: { enabled: !!address && homeChain.configured },
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
      homeChain.configured &&
      isConnected &&
      !!validToken &&
      !tokenDecimalsError &&
      !metadataUnreadable &&
      !!derivedName &&
      !!derivedSymbol &&
      !tokenAlreadyUsed &&
      agreed,
    [homeChain.configured, isConnected, validToken, tokenDecimalsError, metadataUnreadable, derivedName, derivedSymbol, tokenAlreadyUsed, agreed]
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
          Home chain
        </label>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {HOME_CHAIN_WEB_CONFIGS.map((c) => (
            <button
              key={c.homeChainId}
              type="button"
              disabled={!c.configured}
              onClick={() => setHomeChainId(c.homeChainId)}
              className={`rounded-xl border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                homeChainId === c.homeChainId
                  ? "border-blood/60 bg-blood/10 text-bone"
                  : "border-hairline bg-ink-raised text-bone-dim/70 hover:border-hairline-strong"
              }`}
            >
              <span className="font-medium">{c.name}</span>
              {!c.configured && <span className="block text-xs text-bone-dim/40">coming soon</span>}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-bone-dim/50">
          Your token must already exist on this chain — this is where the annual fee gets paid and
          where you&apos;ll bridge {derivedSymbol ?? "it"} in from.
        </p>
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-bone-dim/60">
          Existing ERC20 token address (on {homeChain.name})
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
            Couldn&apos;t read decimals() from this address on {homeChain.name} — is it really an
            ERC20 deployed there?
          </p>
        )}
        {validToken && !tokenDecimalsError && metadataUnreadable && (
          <p className="mt-1.5 text-xs text-blood-bright">
            Couldn&apos;t read name()/symbol() from this token — some non-standard ERC20s return
            bytes32 instead of string here and aren&apos;t supported yet.
          </p>
        )}
        {tokenAlreadyUsed && (
          <p className="mt-1.5 text-xs text-blood-bright">This token already has an active vampchain.</p>
        )}
        {validToken && derivedName && derivedSymbol && tokenDecimals !== undefined && !tokenDecimalsError && (
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-hairline bg-charcoal-soft/50 p-3">
            <TokenLogo address={validToken} chainId={homeChainId} size={36} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-bone">
                {derivedName} <span className="text-bone-dim/60">(${derivedSymbol})</span>
              </p>
              <p className="text-xs text-bone-dim/50">
                {`${String(tokenDecimals)} decimals · your vampchain will be named & ticker'd to match`}
              </p>
            </div>
          </div>
        )}
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
          : this is unaudited, experimental software, the bridge is a single trusted relayer, the
          business could shut down or freeze this chain at any time (best-effort withdrawal
          window only), bridged funds could be lost forever with no legal recourse, and I
          won&apos;t use it for anything illegal.
        </span>
      </label>

      {!isConnected ? (
        <p className="text-sm text-bone-dim/50">Connect your wallet to continue.</p>
      ) : needsApproval ? (
        <button
          disabled={!canSubmit || approving || approveConfirming}
          onClick={async () => {
            await switchChainAsync({ chainId: homeChainId });
            approve({
              address: USDC_ADDRESS,
              abi: ERC20_ABI,
              functionName: "approve",
              args: [REGISTRY_ADDRESS, fee],
            });
          }}
          className="w-full rounded-full bg-bone px-6 py-3.5 text-sm font-semibold uppercase tracking-wider text-ink transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 sm:w-auto"
        >
          {approving || approveConfirming ? "Approving USDC…" : `Approve ${formatUsdc(fee)} USDC`}
        </button>
      ) : (
        <button
          disabled={!canSubmit || creating || createConfirming}
          onClick={async () => {
            if (!validToken || !derivedName || !derivedSymbol) return;
            await switchChainAsync({ chainId: homeChainId });
            createChain({
              address: REGISTRY_ADDRESS,
              abi: REGISTRY_ABI,
              functionName: "createChain",
              args: [validToken, derivedName, derivedSymbol],
            });
          }}
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
