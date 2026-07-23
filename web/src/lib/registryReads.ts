import "server-only";
import { getHomePublicClient } from "./viemClients";
import { REGISTRY_ABI, getHomeChainWebConfig } from "./contracts";

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
/// about (rpcUrl, Fly app name, etc). `homeChainId` picks which of the
/// three home chains' registries to read from — see Chain model's
/// docstring for why a bare `chainId` alone is never enough to know that.
export async function getOnchainChain(homeChainId: number, chainId: bigint): Promise<OnchainChain | null> {
  const cfg = getHomeChainWebConfig(homeChainId);
  if (!cfg || !cfg.configured) return null;
  try {
    const result = (await getHomePublicClient(homeChainId).readContract({
      address: cfg.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "getChain",
      args: [chainId],
    })) as OnchainChain;
    return result;
  } catch {
    return null;
  }
}

export async function getRemainingRuntime(homeChainId: number, chainId: bigint): Promise<bigint> {
  const cfg = getHomeChainWebConfig(homeChainId);
  if (!cfg || !cfg.configured) return 0n;
  try {
    return (await getHomePublicClient(homeChainId).readContract({
      address: cfg.registryAddress,
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
/// actually pay right now — on whichever home chain the user picked.
export async function getDefaultAnnualFee(homeChainId: number): Promise<bigint> {
  const cfg = getHomeChainWebConfig(homeChainId);
  if (!cfg || !cfg.configured) return 0n;
  try {
    return (await getHomePublicClient(homeChainId).readContract({
      address: cfg.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "defaultAnnualFeeUSDC",
    })) as bigint;
  } catch {
    return 0n;
  }
}

/// The runway-treasury address for a home chain's registry — deliberately
/// read live from the contract, same as protocolTreasury, rather than
/// duplicated into a web env var: it's the one place this address is
/// actually authoritative. See VampChainRegistry.runwayTreasury's docstring
/// for why it's a separate wallet from protocolTreasury in the first place.
export async function getRunwayTreasury(homeChainId: number): Promise<`0x${string}` | null> {
  const cfg = getHomeChainWebConfig(homeChainId);
  if (!cfg || !cfg.configured) return null;
  try {
    return (await getHomePublicClient(homeChainId).readContract({
      address: cfg.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "runwayTreasury",
    })) as `0x${string}`;
  } catch {
    return null;
  }
}

/// The protocol-treasury address for a home chain's registry — same
/// "always read live, never duplicated into an env var" reasoning as
/// getRunwayTreasury. Used by ClaimFeesPanel to decide whether the
/// connected wallet is one of the three parties the fee split pays out to.
export async function getProtocolTreasury(homeChainId: number): Promise<`0x${string}` | null> {
  const cfg = getHomeChainWebConfig(homeChainId);
  if (!cfg || !cfg.configured) return null;
  try {
    return (await getHomePublicClient(homeChainId).readContract({
      address: cfg.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "protocolTreasury",
    })) as `0x${string}`;
  } catch {
    return null;
  }
}

export async function getIsActive(homeChainId: number, chainId: bigint): Promise<boolean> {
  const cfg = getHomeChainWebConfig(homeChainId);
  if (!cfg || !cfg.configured) return false;
  try {
    return (await getHomePublicClient(homeChainId).readContract({
      address: cfg.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "isActive",
      args: [chainId],
    })) as boolean;
  } catch {
    return false;
  }
}
