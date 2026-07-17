import { parseAbiItem } from "viem";

export const DEPOSITED_EVENT = parseAbiItem(
  "event Deposited(uint256 indexed chainId, address indexed from, address indexed recipient, uint256 amount, uint256 nonce)"
);

/// General-bridging counterpart to DEPOSITED_EVENT — see
/// VampBridge.depositToken / docs/ARCHITECTURE.md "General ERC20 bridging".
export const DEPOSITED_TOKEN_EVENT = parseAbiItem(
  "event DepositedToken(uint256 indexed chainId, address indexed token, address indexed recipient, address from, uint256 amount, uint256 nonce)"
);

/// Standard ERC20 Transfer event — used to watch for a wrapped-token
/// "burn" on a vampchain (a plain transfer to the treasury address, same
/// signal shape as native-currency recapture).
export const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 amount)"
);

export const ERC20_METADATA_ABI = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

/// VampWrappedTokenFactory's only state-changing entry point the relayer
/// calls — see docs/ARCHITECTURE.md "General ERC20 bridging" for why this
/// is TREASURY-gated rather than permissionless.
export const MINT_WRAPPED_ABI = [
  {
    type: "function",
    name: "mintWrapped",
    stateMutability: "nonpayable",
    inputs: [
      { name: "l1Token", type: "address" },
      { name: "name_", type: "string" },
      { name: "symbol_", type: "string" },
      { name: "decimals_", type: "uint8" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "wrapped", type: "address" }],
  },
  {
    type: "function",
    name: "wrappedAddressOf",
    stateMutability: "view",
    inputs: [{ name: "l1Token", type: "address" }],
    outputs: [{ type: "address" }],
  },
] as const;
