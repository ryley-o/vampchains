import { type Address, type Hex, getAddress, isHex } from "viem";

export interface RelayerConfig {
  l1RpcUrl: string;
  l1ChainId: number;
  bridgeAddress: Address;
  relayerPrivateKey: Hex;
  pollIntervalMs: number;
  confirmations: number;
  burnAddress: Address;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

export function loadConfig(): RelayerConfig {
  const relayerPrivateKey = requireEnv("RELAYER_PRIVATE_KEY");
  if (!isHex(relayerPrivateKey)) throw new Error("RELAYER_PRIVATE_KEY must be a 0x-prefixed hex string");

  return {
    l1RpcUrl: requireEnv("L1_RPC_URL"),
    l1ChainId: Number(requireEnv("L1_CHAIN_ID")),
    bridgeAddress: getAddress(requireEnv("BRIDGE_ADDRESS")),
    relayerPrivateKey,
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 4000),
    confirmations: Number(process.env.CONFIRMATIONS ?? 2),
    burnAddress: getAddress(process.env.BURN_ADDRESS ?? "0x000000000000000000000000000000000000dEaD"),
  };
}
