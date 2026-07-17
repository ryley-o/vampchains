import { parseAbi, parseAbiItem } from "viem";

export const CHAIN_CREATED_EVENT = parseAbiItem(
  "event ChainCreated(uint256 indexed chainId, address indexed baseToken, address indexed creator, string name, string symbol, uint256 initialFunding, uint256 annualFeeUSDC)"
);

export const REGISTRY_ABI = parseAbi([
  "function isActive(uint256 chainId) view returns (bool)",
  "function remainingRuntime(uint256 chainId) view returns (uint256)",
  "function deactivateIfDepleted(uint256 chainId) returns (bool)",
]);

export const ERC20_METADATA_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
