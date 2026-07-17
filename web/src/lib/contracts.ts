import { type Address, getAddress } from "viem";
import RegistryAbiJson from "./abis/VampChainRegistry.json";
import BridgeAbiJson from "./abis/VampBridge.json";

export const REGISTRY_ABI = RegistryAbiJson;
export const BRIDGE_ABI = BridgeAbiJson;

// A placeholder rather than throwing at import time — every page that
// actually needs a real deployment renders a clear "not configured yet"
// state instead of crashing the whole app when env vars are unset (e.g.
// first local checkout before running the deploy script).
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

function envAddress(value: string | undefined): Address {
  if (!value) return ZERO_ADDRESS;
  return getAddress(value);
}

// Each of these must reference `process.env.NEXT_PUBLIC_X` as a literal
// property access, not a computed one (`process.env[name]`) — Next.js
// inlines NEXT_PUBLIC_ vars into the client bundle via static text
// replacement at build time, not a real runtime env object shipped to the
// browser, so a dynamic lookup silently resolves to `undefined` forever,
// regardless of what's actually configured. Confirmed live: this exact
// bug shipped the zero-address fallback to production for every visitor
// until it was caught and fixed here.
export const REGISTRY_ADDRESS = envAddress(process.env.NEXT_PUBLIC_REGISTRY_ADDRESS);
export const BRIDGE_ADDRESS = envAddress(process.env.NEXT_PUBLIC_BRIDGE_ADDRESS);
export const USDC_ADDRESS = envAddress(process.env.NEXT_PUBLIC_USDC_ADDRESS);
export const L1_CHAIN_ID = Number(process.env.NEXT_PUBLIC_L1_CHAIN_ID ?? 31337);
export const L1_RPC_URL = process.env.NEXT_PUBLIC_L1_RPC_URL ?? "http://localhost:8545";
export const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:18080";
export const USDC_DECIMALS = Number(process.env.NEXT_PUBLIC_USDC_DECIMALS ?? 6);
// The withdrawal-signal address on every vampchain: sending native currency
// here signals "I want to withdraw." Deliberately the treasury account
// itself, not a real dead address — recaptured, not destroyed. See
// "Withdrawal signal: recapture, not destroy" in docs/ARCHITECTURE.md.
export const BURN_ADDRESS =
  (process.env.NEXT_PUBLIC_BURN_ADDRESS as Address | undefined) ?? ("0x12f5B89B02C8107278c5F24E74d7B44267C55d1f" as Address);

export const CONTRACTS_CONFIGURED = REGISTRY_ADDRESS !== ZERO_ADDRESS;
