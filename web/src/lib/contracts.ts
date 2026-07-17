import { type Address, getAddress } from "viem";
import RegistryAbiJson from "./abis/VampChainRegistry.json";
import BridgeAbiJson from "./abis/VampBridge.json";

export const REGISTRY_ABI = RegistryAbiJson;
export const BRIDGE_ABI = BridgeAbiJson;

function envAddress(name: string, fallback?: Address): Address {
  const value = process.env[name];
  if (!value) {
    if (fallback) return fallback;
    // A placeholder rather than throwing at import time — every page that
    // actually needs a real deployment renders a clear "not configured yet"
    // state instead of crashing the whole app when env vars are unset
    // (e.g. first local checkout before running the deploy script).
    return "0x0000000000000000000000000000000000000000" as Address;
  }
  return getAddress(value);
}

export const REGISTRY_ADDRESS = envAddress("NEXT_PUBLIC_REGISTRY_ADDRESS");
export const BRIDGE_ADDRESS = envAddress("NEXT_PUBLIC_BRIDGE_ADDRESS");
export const USDC_ADDRESS = envAddress("NEXT_PUBLIC_USDC_ADDRESS");
export const L1_CHAIN_ID = Number(process.env.NEXT_PUBLIC_L1_CHAIN_ID ?? 31337);
export const L1_RPC_URL = process.env.NEXT_PUBLIC_L1_RPC_URL ?? "http://localhost:8545";
export const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:18080";
export const USDC_DECIMALS = Number(process.env.NEXT_PUBLIC_USDC_DECIMALS ?? 6);
export const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD" as Address;

export const CONTRACTS_CONFIGURED = REGISTRY_ADDRESS !== ("0x0000000000000000000000000000000000000000" as Address);
