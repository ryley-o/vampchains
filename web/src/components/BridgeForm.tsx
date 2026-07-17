"use client";

import { useEffect, useState } from "react";
import { type Address, type Hex, createWalletClient, custom, isAddress, parseEther, parseUnits } from "viem";
import { useAccount, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { BRIDGE_ADDRESS, BRIDGE_ABI, BURN_ADDRESS, GATEWAY_URL, L1_CHAIN_ID } from "@/lib/contracts";
import { ERC20_ABI } from "@/lib/erc20Abi";
import { makeVampchainChain } from "@/lib/viemClients";

interface BridgeFormProps {
  chainId: bigint;
  baseToken: Address;
  baseTokenSymbol: string;
  baseTokenDecimals: number;
  evmChainId: bigint;
  gatewayRpcUrl: string;
}

interface ClaimStatus {
  status: "pending" | "ready";
  chainId?: string;
  to?: Address;
  amount?: string;
  sidechainTxHash?: string;
  signature?: Hex;
}

function getEthereumProvider() {
  return (window as unknown as { ethereum?: { request: (args: unknown) => Promise<unknown> } }).ethereum;
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
  const { switchChainAsync } = useSwitchChain();
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

  // --- withdrawal: burn on the vampchain, then claim on the home chain ---
  const [burnAmount, setBurnAmount] = useState("");
  const [burning, setBurning] = useState(false);
  const [burnError, setBurnError] = useState<string | null>(null);
  const [burnTxHash, setBurnTxHash] = useState<Hex | null>(null);
  const [claim, setClaim] = useState<ClaimStatus | null>(null);

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

  async function addToWallet() {
    const eth = getEthereumProvider();
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

  async function burnToWithdraw() {
    const eth = getEthereumProvider();
    if (!eth || !address) return;
    setBurnError(null);
    setBurning(true);
    try {
      const value = parseEther(burnAmount);

      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${evmChainId.toString(16)}` }] });
      } catch {
        await addToWallet();
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${evmChainId.toString(16)}` }] });
      }

      const vampchain = makeVampchainChain(evmChainId, baseTokenSymbol, chainId);
      const walletClient = createWalletClient({ chain: vampchain, transport: custom(eth) });
      const hash = await walletClient.sendTransaction({ account: address, to: BURN_ADDRESS, value });

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
    await switchChainAsync({ chainId: L1_CHAIN_ID });
    submitClaim({
      address: BRIDGE_ADDRESS,
      abi: BRIDGE_ABI,
      functionName: "claim",
      args: [BigInt(claim.chainId!), claim.to!, BigInt(claim.amount!), claim.sidechainTxHash as Hex, claim.signature!],
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
          Burning sends native currency on the vampchain to the burn address. The relayer sees it
          and signs a claim — you then submit that claim yourself on Base, so you pay your own gas
          and we never touch your funds in between.
        </p>

        <button
          onClick={addToWallet}
          className="mt-3 rounded border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-800"
        >
          Add vampchain to wallet
        </button>

        {!claim && (
          <div className="mt-3 flex gap-2">
            <input
              value={burnAmount}
              onChange={(e) => setBurnAmount(e.target.value)}
              placeholder={`Amount to burn (${baseTokenSymbol})`}
              className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
            />
            <button
              disabled={!burnAmount || burning || !isConnected}
              onClick={burnToWithdraw}
              className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
            >
              {burning ? "Burning..." : "Burn to withdraw"}
            </button>
          </div>
        )}
        {burnError && <p className="mt-2 text-sm text-red-400">{burnError}</p>}

        {claim?.status === "pending" && (
          <p className="mt-3 text-sm text-neutral-400">
            Burn confirmed (tx {burnTxHash?.slice(0, 10)}...) — waiting for the relayer to sign your
            claim, usually well under a minute.
          </p>
        )}

        {claim?.status === "ready" && (
          <div className="mt-3">
            <p className="text-sm text-green-400">Claim ready.</p>
            <button
              disabled={claiming || claimConfirming}
              onClick={doClaim}
              className="mt-2 rounded bg-neutral-100 px-4 py-2 text-sm font-medium text-black hover:bg-white disabled:opacity-50"
            >
              {claiming || claimConfirming ? "Claiming..." : `Claim on Base (you pay gas)`}
            </button>
            {claimError && <p className="mt-2 text-sm text-red-400">{claimError.message}</p>}
            {claimConfirmed && <p className="mt-2 text-sm text-green-400">Claimed — funds are back on the home chain.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
