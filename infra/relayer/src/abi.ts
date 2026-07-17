import { parseAbi, parseAbiItem } from "viem";

export const DEPOSITED_EVENT = parseAbiItem(
  "event Deposited(uint256 indexed chainId, address indexed from, address indexed recipient, uint256 amount, uint256 nonce)"
);

export const BRIDGE_ABI = parseAbi([
  "function release(uint256 chainId, address to, uint256 amount, bytes32 sidechainTxHash) external",
]);
