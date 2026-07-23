import "server-only";
import type { Address } from "viem";
import { prisma } from "@vampchains/db";
import { getHomePublicClient } from "./viemClients";
import { BRIDGE_ABI, getHomeChainWebConfig } from "./contracts";

/// Cumulative base-fee revenue this chain has already recaptured and split
/// three ways between its creator, the protocol treasury, and the runway
/// treasury (see VampBridge.claimBurnedFees / docs/ARCHITECTURE.md "Protocol fee
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

export interface OutstandingBurnedFees {
  cumulativeBurned: bigint;
  asOfBlock: bigint;
  signature: `0x${string}`;
  outstandingAmount: bigint;
}

/// Whether there's currently a real `claimBurnedFees` call worth making for
/// this chain — combines the relayer's latest signed attestation (already
/// stored on the Chain row by baseFeeWatcher.ts) with a live
/// `burnedFeesClaimed` read, since the attestation alone doesn't say
/// whether it's already been claimed. Returns null if nothing has ever been
/// signed yet, or if the signed total has already been fully claimed —
/// both cases mean "nothing to show," not an error.
export async function getOutstandingBurnedFees(
  homeChainId: number,
  chainId: bigint,
  dbChain: { cumulativeBaseFeeBurned: string; baseFeeScanBlock: bigint; baseFeeAttestationSignature: string | null }
): Promise<OutstandingBurnedFees | null> {
  if (!dbChain.baseFeeAttestationSignature) return null;
  const cumulativeBurned = BigInt(dbChain.cumulativeBaseFeeBurned);
  const alreadyClaimed = await getBurnedFeesClaimed(homeChainId, chainId);
  if (cumulativeBurned <= alreadyClaimed) return null;
  return {
    cumulativeBurned,
    asOfBlock: dbChain.baseFeeScanBlock,
    signature: dbChain.baseFeeAttestationSignature as `0x${string}`,
    outstandingAmount: cumulativeBurned - alreadyClaimed,
  };
}

export interface OutstandingSweepClaim {
  sidechainTxHash: `0x${string}`;
  amount: bigint;
  signature: `0x${string}`;
}

/// Every signed-but-not-yet-claimed tip-sweep for this chain. Each sweep is
/// a real, distinct transaction with its own ClaimSwept signature — unlike
/// the single running burned-fees attestation above, these can pile up as
/// multiple independent outstanding claims (one per historical sweep). The
/// `claimed(sidechainTxHash)` mapping on-chain is the only real source of
/// truth for whether one's been redeemed already — WithdrawalEvent's own
/// `claimTxHash`/`claimedAt` columns exist but nothing currently writes
/// them, per the model's docstring, so this checks on-chain directly rather
/// than trusting those columns.
export async function getOutstandingSweepClaims(
  chainDbId: number,
  homeChainId: number,
  bridgeAddress: Address
): Promise<OutstandingSweepClaim[]> {
  const rows = await prisma.withdrawalEvent.findMany({
    where: { chainDbId, kind: "FEE_SWEEP", signature: { not: null } },
  });
  if (rows.length === 0) return [];

  const client = getHomePublicClient(homeChainId);
  const claimedFlags = await Promise.all(
    rows.map((row) =>
      client.readContract({
        address: bridgeAddress,
        abi: BRIDGE_ABI,
        functionName: "claimed",
        args: [row.sidechainTxHash as `0x${string}`],
      }) as Promise<boolean>
    )
  );

  return rows
    .filter((_, i) => !claimedFlags[i])
    .map((row) => ({
      sidechainTxHash: row.sidechainTxHash as `0x${string}`,
      amount: BigInt(row.amount),
      signature: row.signature as `0x${string}`,
    }));
}
