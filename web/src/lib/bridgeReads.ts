import "server-only";
import { getHomePublicClient } from "./viemClients";
import { BRIDGE_ABI, getHomeChainWebConfig } from "./contracts";

/// Total protocol fee revenue (tips + base-fee burn as one figure) this
/// chain has already claimed and split three ways between its creator, the
/// protocol treasury, and the runway treasury (see
/// VampBridge.claimFeeRevenue / docs/ARCHITECTURE.md "Protocol fee
/// revenue"). In the base token's own raw decimal units — format with
/// `formatTokenAmount(amount, baseTokenDecimals)`. `homeChainId` picks
/// which home chain's VampBridge to read from.
export async function getFeeRevenueClaimed(homeChainId: number, chainId: bigint): Promise<bigint> {
  const cfg = getHomeChainWebConfig(homeChainId);
  if (!cfg || !cfg.configured) return 0n;
  try {
    return (await getHomePublicClient(homeChainId).readContract({
      address: cfg.bridgeAddress,
      abi: BRIDGE_ABI,
      functionName: "feeRevenueClaimed",
      args: [chainId],
    })) as bigint;
  } catch {
    return 0n;
  }
}

export interface OutstandingFeeRevenue {
  cumulativeRevenue: bigint;
  asOfBlock: bigint;
  signature: `0x${string}`;
  outstandingAmount: bigint;
  /// The two components of the cumulative total, in native 18-decimal wei,
  /// purely for display ("X in tips + Y in base fee"). Not part of what's
  /// signed or claimed — the attestation covers the raw-unit sum.
  tipsNativeWei: bigint;
  baseFeeNativeWei: bigint;
}

/// Whether there's a real `claimFeeRevenue` call worth making for this
/// chain right now — combines the relayer's latest signed attestation
/// (stored on the Chain row by gasContributionWatcher.ts) with a live
/// `feeRevenueClaimed` read, since the attestation alone doesn't say
/// whether it's already been claimed. One cumulative counter now covers
/// both tips and base-fee burn, so this is the single source for the whole
/// claim UI — no more per-sweep pileup. Returns null when nothing has been
/// signed yet, or the signed total is already fully claimed.
export async function getOutstandingFeeRevenue(
  homeChainId: number,
  chainId: bigint,
  dbChain: {
    cumulativeFeeRevenue: string;
    feeRevenueAsOfBlock: bigint;
    feeRevenueAttestationSignature: string | null;
    cumulativeTipsNativeWei: string;
    cumulativeBaseFeeBurnedNativeWei: string;
  }
): Promise<OutstandingFeeRevenue | null> {
  if (!dbChain.feeRevenueAttestationSignature) return null;
  const cumulativeRevenue = BigInt(dbChain.cumulativeFeeRevenue);
  const alreadyClaimed = await getFeeRevenueClaimed(homeChainId, chainId);
  if (cumulativeRevenue <= alreadyClaimed) return null;
  return {
    cumulativeRevenue,
    asOfBlock: dbChain.feeRevenueAsOfBlock,
    signature: dbChain.feeRevenueAttestationSignature as `0x${string}`,
    outstandingAmount: cumulativeRevenue - alreadyClaimed,
    tipsNativeWei: BigInt(dbChain.cumulativeTipsNativeWei),
    baseFeeNativeWei: BigInt(dbChain.cumulativeBaseFeeBurnedNativeWei),
  };
}
