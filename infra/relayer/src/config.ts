import { type Address, type Hex, getAddress, isHex } from "viem";

export interface RelayerConfig {
  l1RpcUrl: string;
  l1ChainId: number;
  bridgeAddress: Address;
  relayerPrivateKey: Hex;
  /// Signs real transfers on each vampchain to mint deposits. Never touches
  /// L1, never needs L1 gas; it only ever spends the vampchain's own
  /// pre-funded native currency, on the vampchain itself. See
  /// docs/ARCHITECTURE.md "Why geth Clique PoA".
  treasuryPrivateKey: Hex;
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

  const treasuryPrivateKey = requireEnv("TREASURY_PRIVATE_KEY");
  if (!isHex(treasuryPrivateKey)) throw new Error("TREASURY_PRIVATE_KEY must be a 0x-prefixed hex string");

  return {
    l1RpcUrl: requireEnv("L1_RPC_URL"),
    l1ChainId: Number(requireEnv("L1_CHAIN_ID")),
    bridgeAddress: getAddress(requireEnv("BRIDGE_ADDRESS")),
    relayerPrivateKey,
    treasuryPrivateKey,
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 4000),
    confirmations: Number(process.env.CONFIRMATIONS ?? 2),
    // The withdrawal-signal address on every vampchain: sending native
    // currency here signals "I want to withdraw." Deliberately the same
    // treasury account minting spends from, not a real dead address — see
    // "Withdrawal signal: recapture, not destroy" in docs/ARCHITECTURE.md.
    burnAddress: getAddress(process.env.BURN_ADDRESS ?? "0x12f5B89B02C8107278c5F24E74d7B44267C55d1f"),
  };
}
