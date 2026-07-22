import "server-only";
import { l1PublicClient } from "./viemClients";
import { REGISTRY_ABI, REGISTRY_ADDRESS, CONTRACTS_CONFIGURED } from "./contracts";

export interface OnchainChain {
  baseToken: `0x${string}`;
  creator: `0x${string}`;
  name: string;
  symbol: string;
  createdAt: bigint;
  lastAccrualAt: bigint;
  fundingBalance: bigint;
  annualFeeUSDC: bigint;
  active: boolean;
}

/// Funding data is read live from the registry rather than from Postgres —
/// per docs/ARCHITECTURE.md, the contracts are always the source of truth;
/// Postgres only tracks infra/provisioning state the contracts don't know
/// about (rpcUrl, Fly app name, etc).
export async function getOnchainChain(chainId: bigint): Promise<OnchainChain | null> {
  if (!CONTRACTS_CONFIGURED) return null;
  try {
    const result = (await l1PublicClient.readContract({
      address: REGISTRY_ADDRESS,
      abi: REGISTRY_ABI,
      functionName: "getChain",
      args: [chainId],
    })) as OnchainChain;
    return result;
  } catch {
    return null;
  }
}

export async function getRemainingRuntime(chainId: bigint): Promise<bigint> {
  if (!CONTRACTS_CONFIGURED) return 0n;
  try {
    return (await l1PublicClient.readContract({
      address: REGISTRY_ADDRESS,
      abi: REGISTRY_ABI,
      functionName: "remainingRuntime",
      args: [chainId],
    })) as bigint;
  } catch {
    return 0n;
  }
}

/// Read live rather than hardcoded in copy: the owner can adjust
/// `defaultAnnualFeeUSDC` at any time (never retroactively, per-chain rates
/// stay locked in at creation — see VampChainRegistry.sol), so anywhere the
/// site quotes "the current fee" should reflect what a new chain would
/// actually pay right now.
export async function getDefaultAnnualFee(): Promise<bigint> {
  if (!CONTRACTS_CONFIGURED) return 0n;
  try {
    return (await l1PublicClient.readContract({
      address: REGISTRY_ADDRESS,
      abi: REGISTRY_ABI,
      functionName: "defaultAnnualFeeUSDC",
    })) as bigint;
  } catch {
    return 0n;
  }
}

export async function getIsActive(chainId: bigint): Promise<boolean> {
  if (!CONTRACTS_CONFIGURED) return false;
  try {
    return (await l1PublicClient.readContract({
      address: REGISTRY_ADDRESS,
      abi: REGISTRY_ABI,
      functionName: "isActive",
      args: [chainId],
    })) as boolean;
  } catch {
    return false;
  }
}
