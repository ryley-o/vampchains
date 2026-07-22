import { parseAbi, parseAbiItem } from "viem";

export const CHAIN_CREATED_EVENT = parseAbiItem(
  "event ChainCreated(uint256 indexed chainId, address indexed baseToken, address indexed creator, string name, string symbol, uint256 initialFunding, uint256 annualFeeUSDC)"
);

export const REGISTRY_ABI = parseAbi([
  "function isActive(uint256 chainId) view returns (bool)",
  "function remainingRuntime(uint256 chainId) view returns (uint256)",
  "function isPastGrace(uint256 chainId) view returns (bool)",
  "function deactivateIfGraceExpired(uint256 chainId) returns (bool)",
]);

/// Just the entry points the provisioner itself calls — a full ABI import
/// isn't needed here. `publishSnapshot`/`sweepUnclaimed` are the tail end
/// of a chain's lifecycle (see docs/ARCHITECTURE.md "Protocol fee revenue"
/// snapshot-claim mechanism); `snapshotRoot`/`snapshotPublishedAt` are read
/// back to avoid re-publishing or re-sweeping the same chain twice.
export const BRIDGE_ABI = parseAbi([
  "function publishSnapshot(uint256 chainId, bytes32 root, bytes signature)",
  "function sweepUnclaimed(uint256 chainId, address token) returns (uint256)",
  "function snapshotRoot(uint256 chainId) view returns (bytes32)",
  "function snapshotPublishedAt(uint256 chainId) view returns (uint256)",
]);

export const ERC20_METADATA_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

/// Standard ERC20 Transfer event — used to enumerate every unique holder a
/// general-bridged wrapped token ever had on a vampchain, when building its
/// final snapshot (see snapshotBuilder.ts).
export const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 amount)"
);
