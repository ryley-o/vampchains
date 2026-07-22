import "server-only";
import { getHomePublicClient } from "./viemClients";
import { BRIDGE_ABI, getHomeChainWebConfig } from "./contracts";

/// Cumulative base-fee revenue this chain has already recaptured and split
/// 50/50 between its creator and the protocol treasury (see
/// VampBridge.claimBurnedFees / docs/ARCHITECTURE.md "Protocol fee
/// revenue"). In the base token's own raw decimal units — format with
/// `formatTokenAmount(amount, baseTokenDecimals)`. This is a live, honest
/// floor on what a chain has actually earned so far — it doesn't include
/// swept tip revenue that hasn't been indexed back here yet, so the real
/// total paid out to a creator is always at least this much. `homeChainId`
/// picks which home chain's VampBridge to read from.
export async function getBurnedFeesClaimed(homeChainId: number, chainId: bigint): Promise<bigint> {
  const cfg = getHomeChainWebConfig(homeChainId);
  if (!cfg || !cfg.configured) return 0n;
  try {
    return (await getHomePublicClient(homeChainId).readContract({
      address: cfg.bridgeAddress,
      abi: BRIDGE_ABI,
      functionName: "burnedFeesClaimed",
      args: [chainId],
    })) as bigint;
  } catch {
    return 0n;
  }
}
