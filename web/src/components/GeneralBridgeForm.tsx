"use client";

import { useEffect, useState } from "react";
import { type Address, type Hex, createWalletClient, custom, isAddress, parseUnits } from "viem";
import { useAccount, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { BRIDGE_ABI, BURN_ADDRESS, GATEWAY_URL, requireHomeChainWebConfig } from "@/lib/contracts";
import { ERC20_ABI } from "@/lib/erc20Abi";
import { makeVampchainChain } from "@/lib/viemClients";
import { shortAddress } from "@/lib/format";

export interface WrappedTokenInfo {
  l1Token: Address;
  wrapped: Address;
  name: string;
  symbol: string;
  decimals: number;
}

interface GeneralBridgeFormProps {
  chainId: bigint;
  homeChainId: number;
  baseTokenSymbol: string;
  evmChainId: bigint;
  gatewayRpcUrl: string;
  wrappedTokens: WrappedTokenInfo[];
}

interface ClaimStatus {
  status: "pending" | "ready";
  chainId?: string;
  token?: Address;
  to?: Address;
  amount?: string;
  sidechainTxHash?: string;
  signature?: Hex;
}

function getEthereumProvider() {
  return (window as unknown as { ethereum?: { request: (args: unknown) => Promise<unknown> } }).ethereum;
}

/// Bridges any ERC20 other than a chain's own base token — that one gets
/// native-currency treatment via BridgeForm/deposit/claim instead. Here,
/// deposits mint a wrapped ERC20 on the vampchain (deployed automatically
/// by the relayer on first use, at a deterministic address — see
/// docs/ARCHITECTURE.md "General ERC20 bridging"), and withdrawing is a
/// plain transfer to the treasury address on the vampchain, same signal
/// shape as native-currency recapture.
export function GeneralBridgeForm({
  chainId,
  homeChainId,
  baseTokenSymbol,
  evmChainId,
  gatewayRpcUrl,
  wrappedTokens,
}: GeneralBridgeFormProps) {
  const { address, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  const homeChain = requireHomeChainWebConfig(homeChainId);
  const BRIDGE_ADDRESS = homeChain.bridgeAddress;

  // --- deposit: lock any ERC20 here, wrapped balance minted on the vampchain ---
  const [tokenInput, setTokenInput] = useState("");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");

  const token = isAddress(tokenInput) ? (tokenInput as Address) : undefined;
  const effectiveRecipient = isAddress(recipient) ? (recipient as Address) : address;

  const { data: tokenMeta } = useReadContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "symbol",
    chainId: homeChainId,
    query: { enabled: !!token },
  });
  const { data: tokenDecimals } = useReadContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "decimals",
    chainId: homeChainId,
    query: { enabled: !!token },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address && token ? [address, BRIDGE_ADDRESS] : undefined,
    chainId: homeChainId,
    query: { enabled: !!address && !!token },
  });

  let parsedAmount: bigint | undefined;
  try {
    parsedAmount = amount && tokenDecimals !== undefined ? parseUnits(amount, tokenDecimals) : undefined;
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

  // --- withdrawal: transfer the wrapped token to the treasury on the vampchain, then claim ---
  const [selectedWrapped, setSelectedWrapped] = useState<Address | "">(wrappedTokens[0]?.wrapped ?? "");
  const [burnAmount, setBurnAmount] = useState("");
  const [burning, setBurning] = useState(false);
  const [burnError, setBurnError] = useState<string | null>(null);
  const [burnTxHash, setBurnTxHash] = useState<Hex | null>(null);
  const [claim, setClaim] = useState<ClaimStatus | null>(null);

  const selected = wrappedTokens.find((w) => w.wrapped === selectedWrapped);

  const { writeContract: submitClaim, data: claimTxHash, isPending: claiming, error: claimError } = useWriteContract();
  const { isLoading: claimConfirming, isSuccess: claimConfirmed } = useWaitForTransactionReceipt({
    hash: claimTxHash,
  });

  useEffect(() => {
    if (!burnTxHash || claim?.status === "ready") return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${GATEWAY_URL}/claims/${burnTxHash}`);
        const data: ClaimStatus = await res.json();
        if (!cancelled && data.status === "ready") setClaim(data);
      } catch {
        // transient network hiccup — keep polling
      }
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [burnTxHash, claim?.status]);

  async function burnToWithdraw() {
    const eth = getEthereumProvider();
    if (!eth || !address || !selected) return;
    setBurnError(null);
    setBurning(true);
    try {
      const value = parseUnits(burnAmount, selected.decimals);

      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${evmChainId.toString(16)}` }] });
      } catch {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: `0x${evmChainId.toString(16)}`,
              chainName: `vampchain-${chainId}`,
              nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
              rpcUrls: [gatewayRpcUrl],
            },
          ],
        });
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${evmChainId.toString(16)}` }] });
      }

      const vampchain = makeVampchainChain(evmChainId, "ETH");
      const walletClient = createWalletClient({ chain: vampchain, transport: custom(eth) });
      const hash = await walletClient.writeContract({
        account: address,
        address: selected.wrapped,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [BURN_ADDRESS, value],
      });

      setBurnTxHash(hash);
      setClaim({ status: "pending" });
    } catch (err) {
      setBurnError(err instanceof Error ? err.message : "burn failed");
    } finally {
      setBurning(false);
    }
  }

  async function doClaim() {
    if (!claim || claim.status !== "ready") return;
    await switchChainAsync({ chainId: homeChainId });
    submitClaim({
      address: BRIDGE_ADDRESS,
      abi: BRIDGE_ABI,
      functionName: "claimToken",
      args: [
        BigInt(claim.chainId!),
        claim.token!,
        claim.to!,
        BigInt(claim.amount!),
        claim.sidechainTxHash as Hex,
        claim.signature!,
      ],
    });
  }

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-display text-lg text-bone">Deposit any other ERC20</h3>
        <p className="mt-1.5 text-sm text-bone-dim/60">
          Locks any token here (other than this chain&apos;s own {baseTokenSymbol}, which gets
          native-currency treatment via the bridge above) and mints a wrapped representation on
          the vampchain instead — the relayer deploys it automatically on first use, at a
          deterministic address.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder={`Token address (on ${homeChain.name})`}
            className="rounded-xl border border-hairline bg-ink-raised px-3 py-2.5 font-mono text-sm text-bone placeholder:text-bone-dim/30 focus:border-blood/60"
          />
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`Amount${tokenMeta ? ` (${tokenMeta})` : ""}`}
            className="rounded-xl border border-hairline bg-ink-raised px-3 py-2.5 text-sm text-bone placeholder:text-bone-dim/30 focus:border-blood/60"
          />
        </div>
        <input
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="Recipient (defaults to you)"
          className="mt-3 w-full rounded-xl border border-hairline bg-ink-raised px-3 py-2.5 font-mono text-sm text-bone placeholder:text-bone-dim/30 focus:border-blood/60"
        />

        {!isConnected ? (
          <p className="mt-4 text-sm text-bone-dim/50">Connect your wallet to bridge.</p>
        ) : !token ? (
          <p className="mt-4 text-sm text-bone-dim/50">Enter a valid token address.</p>
        ) : needsApproval ? (
          <button
            disabled={!parsedAmount || approving || approveConfirming}
            onClick={async () => {
              if (!parsedAmount) return;
              await switchChainAsync({ chainId: homeChainId });
              approve({ address: token, abi: ERC20_ABI, functionName: "approve", args: [BRIDGE_ADDRESS, parsedAmount] });
            }}
            className="mt-4 rounded-full bg-bone px-6 py-2.5 text-sm font-semibold text-ink transition-transform hover:scale-[1.02] disabled:opacity-40 disabled:hover:scale-100"
          >
            {approving || approveConfirming ? "Approving…" : `Approve ${tokenMeta ?? "token"}`}
          </button>
        ) : (
          <button
            disabled={!parsedAmount || !effectiveRecipient || depositing || depositConfirming}
            onClick={async () => {
              if (!parsedAmount || !effectiveRecipient) return;
              await switchChainAsync({ chainId: homeChainId });
              deposit({
                address: BRIDGE_ADDRESS,
                abi: BRIDGE_ABI,
                functionName: "depositToken",
                args: [chainId, token, parsedAmount, effectiveRecipient],
              });
            }}
            className="mt-4 rounded-full bg-blood px-6 py-2.5 text-sm font-semibold text-bone shadow-[0_0_30px_rgba(226,45,58,0.25)] transition-transform hover:scale-[1.02] hover:bg-blood-bright disabled:opacity-40 disabled:hover:scale-100"
          >
            {depositing || depositConfirming ? "Depositing…" : "Deposit & mint wrapped token"}
          </button>
        )}
        {depositError && <p className="mt-2 text-sm text-blood-bright">{depositError.message}</p>}
        {depositConfirmed && <p className="mt-2 text-sm text-emerald-300">Deposited — wrapped mint should land shortly.</p>}
      </div>

      <div className="border-t border-hairline pt-8">
        <h3 className="text-display text-lg text-bone">Withdraw a wrapped token</h3>
        {wrappedTokens.length === 0 ? (
          <p className="mt-1.5 text-sm text-bone-dim/50">
            No tokens have been general-bridged to this chain yet — deposit one above first.
          </p>
        ) : (
          <>
            <p className="mt-1.5 text-sm text-bone-dim/60">
              Transferring a wrapped token to the treasury address on the vampchain signals a
              withdrawal, exactly like sending native currency there — the relayer sees it and
              signs a claim you submit yourself on Base.
            </p>
            <select
              value={selectedWrapped}
              onChange={(e) => setSelectedWrapped(e.target.value as Address)}
              className="mt-4 w-full rounded-xl border border-hairline bg-ink-raised px-3 py-2.5 text-sm text-bone focus:border-blood/60"
            >
              {wrappedTokens.map((w) => (
                <option key={w.wrapped} value={w.wrapped}>
                  {w.symbol} — {shortAddress(w.wrapped)} (from {shortAddress(w.l1Token)})
                </option>
              ))}
            </select>

            {!claim && (
              <div className="mt-3 flex gap-2">
                <input
                  value={burnAmount}
                  onChange={(e) => setBurnAmount(e.target.value)}
                  placeholder={`Amount to withdraw${selected ? ` (${selected.symbol})` : ""}`}
                  className="flex-1 rounded-xl border border-hairline bg-ink-raised px-3 py-2.5 text-sm text-bone placeholder:text-bone-dim/30 focus:border-blood/60"
                />
                <button
                  disabled={!burnAmount || burning || !isConnected || !selected}
                  onClick={burnToWithdraw}
                  className="rounded-full bg-blood px-5 py-2.5 text-sm font-semibold text-bone transition-transform hover:scale-[1.02] hover:bg-blood-bright disabled:opacity-40 disabled:hover:scale-100"
                >
                  {burning ? "Sending…" : "Send to withdraw"}
                </button>
              </div>
            )}
            {burnError && <p className="mt-2 text-sm text-blood-bright">{burnError}</p>}

            {claim?.status === "pending" && (
              <p className="mt-4 flex items-center gap-2 text-sm text-bone-dim/60">
                <span className="h-1.5 w-1.5 animate-heartbeat rounded-full bg-amber-400" />
                Transfer confirmed (tx {burnTxHash?.slice(0, 10)}…) — waiting for the relayer to
                sign your claim, usually well under a minute.
              </p>
            )}

            {claim?.status === "ready" && (
              <div className="mt-4">
                <p className="text-sm text-emerald-300">Claim ready.</p>
                <button
                  disabled={claiming || claimConfirming}
                  onClick={doClaim}
                  className="mt-2 rounded-full bg-bone px-6 py-2.5 text-sm font-semibold text-ink transition-transform hover:scale-[1.02] disabled:opacity-40 disabled:hover:scale-100"
                >
                  {claiming || claimConfirming ? "Claiming…" : "Claim on Base (you pay gas)"}
                </button>
                {claimError && <p className="mt-2 text-sm text-blood-bright">{claimError.message}</p>}
                {claimConfirmed && <p className="mt-2 text-sm text-emerald-300">Claimed — funds are back on Base.</p>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
