import { type Address, getAddress } from "viem";
import { HOME_CHAINS, type HomeChainKey } from "@vampchains/chains";
import RegistryAbiJson from "./abis/VampChainRegistry.json";
import BridgeAbiJson from "./abis/VampBridge.json";

export const REGISTRY_ABI = RegistryAbiJson;
export const BRIDGE_ABI = BridgeAbiJson;

// A placeholder rather than throwing at import time — every page that
// actually needs a real deployment renders a clear "not configured yet"
// state instead of crashing the whole app when env vars are unset (e.g.
// first local checkout before running the deploy script, or one of the
// three home chains not deployed yet — see ROBINHOOD_CONFIG below).
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

function envAddress(value: string | undefined): Address {
  if (!value) return ZERO_ADDRESS;
  return getAddress(value);
}

export interface HomeChainWebConfig {
  homeChainId: number;
  key: HomeChainKey;
  name: string;
  isTestnet: boolean;
  nativeCurrencySymbol: string;
  registryAddress: Address;
  bridgeAddress: Address;
  usdcAddress: Address;
  usdcDecimals: number;
  /// Public-facing RPC URL — fine for wallet chain-add/switch and client
  /// reads; falls back to `@vampchains/chains`' public endpoint when no
  /// env override is set. Server-side code that actually needs a reliable
  /// provider should still prefer a paid RPC via this same var.
  rpcUrl: string;
  /// True once this home chain's registry/bridge are actually deployed and
  /// wired up here — false for a home chain still pending rollout (see
  /// `@vampchains/chains`' docstring on why a partial rollout is expected).
  configured: boolean;
}

// Each of these must reference `process.env.NEXT_PUBLIC_X` as a literal
// property access, not a computed one (`process.env[name]`) — Next.js
// inlines NEXT_PUBLIC_ vars into the client bundle via static text
// replacement at build time, not a real runtime env object shipped to the
// browser, so a dynamic lookup silently resolves to `undefined` forever,
// regardless of what's actually configured. Confirmed live: this exact bug
// shipped the zero-address fallback to production for every visitor until
// it was caught and fixed here — so this is written out three times by
// hand (one per home chain) rather than looped over `HOME_CHAINS`.
const BASE_REGISTRY_ADDRESS = envAddress(process.env.NEXT_PUBLIC_BASE_REGISTRY_ADDRESS);
const BASE_CONFIG: HomeChainWebConfig = {
  homeChainId: HOME_CHAINS[0].id,
  key: HOME_CHAINS[0].key,
  name: HOME_CHAINS[0].name,
  isTestnet: HOME_CHAINS[0].isTestnet,
  nativeCurrencySymbol: HOME_CHAINS[0].nativeCurrencySymbol,
  registryAddress: BASE_REGISTRY_ADDRESS,
  bridgeAddress: envAddress(process.env.NEXT_PUBLIC_BASE_BRIDGE_ADDRESS),
  usdcAddress: envAddress(process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS),
  usdcDecimals: Number(process.env.NEXT_PUBLIC_BASE_USDC_DECIMALS ?? 6),
  rpcUrl: process.env.NEXT_PUBLIC_BASE_L1_RPC_URL ?? HOME_CHAINS[0].publicRpcUrl,
  configured: BASE_REGISTRY_ADDRESS !== ZERO_ADDRESS,
};

const ETHEREUM_REGISTRY_ADDRESS = envAddress(process.env.NEXT_PUBLIC_ETHEREUM_REGISTRY_ADDRESS);
const ETHEREUM_CONFIG: HomeChainWebConfig = {
  homeChainId: HOME_CHAINS[1].id,
  key: HOME_CHAINS[1].key,
  name: HOME_CHAINS[1].name,
  isTestnet: HOME_CHAINS[1].isTestnet,
  nativeCurrencySymbol: HOME_CHAINS[1].nativeCurrencySymbol,
  registryAddress: ETHEREUM_REGISTRY_ADDRESS,
  bridgeAddress: envAddress(process.env.NEXT_PUBLIC_ETHEREUM_BRIDGE_ADDRESS),
  usdcAddress: envAddress(process.env.NEXT_PUBLIC_ETHEREUM_USDC_ADDRESS),
  usdcDecimals: Number(process.env.NEXT_PUBLIC_ETHEREUM_USDC_DECIMALS ?? 6),
  rpcUrl: process.env.NEXT_PUBLIC_ETHEREUM_L1_RPC_URL ?? HOME_CHAINS[1].publicRpcUrl,
  configured: ETHEREUM_REGISTRY_ADDRESS !== ZERO_ADDRESS,
};

const ROBINHOOD_REGISTRY_ADDRESS = envAddress(process.env.NEXT_PUBLIC_ROBINHOOD_REGISTRY_ADDRESS);
const ROBINHOOD_CONFIG: HomeChainWebConfig = {
  homeChainId: HOME_CHAINS[2].id,
  key: HOME_CHAINS[2].key,
  name: HOME_CHAINS[2].name,
  isTestnet: HOME_CHAINS[2].isTestnet,
  nativeCurrencySymbol: HOME_CHAINS[2].nativeCurrencySymbol,
  registryAddress: ROBINHOOD_REGISTRY_ADDRESS,
  bridgeAddress: envAddress(process.env.NEXT_PUBLIC_ROBINHOOD_BRIDGE_ADDRESS),
  usdcAddress: envAddress(process.env.NEXT_PUBLIC_ROBINHOOD_USDC_ADDRESS),
  usdcDecimals: Number(process.env.NEXT_PUBLIC_ROBINHOOD_USDC_DECIMALS ?? 6),
  rpcUrl: process.env.NEXT_PUBLIC_ROBINHOOD_L1_RPC_URL ?? HOME_CHAINS[2].publicRpcUrl,
  configured: ROBINHOOD_REGISTRY_ADDRESS !== ZERO_ADDRESS,
};

/// All three home chains, always present in this array regardless of
/// whether each is actually deployed yet — see `configured` per entry.
/// Callers that only care about chains a user can actually pick right now
/// should filter on `.configured`.
export const HOME_CHAIN_WEB_CONFIGS: HomeChainWebConfig[] = [BASE_CONFIG, ETHEREUM_CONFIG, ROBINHOOD_CONFIG];

export function getHomeChainWebConfig(homeChainId: number): HomeChainWebConfig | undefined {
  return HOME_CHAIN_WEB_CONFIGS.find((c) => c.homeChainId === homeChainId);
}

export function requireHomeChainWebConfig(homeChainId: number): HomeChainWebConfig {
  const cfg = getHomeChainWebConfig(homeChainId);
  if (!cfg) throw new Error(`unknown home chain id: ${homeChainId}`);
  return cfg;
}

/// True as soon as at least one home chain is wired up — individual pages
/// still check a specific chain's own `.configured` before rendering
/// anything that needs its registry/bridge.
export const CONTRACTS_CONFIGURED = HOME_CHAIN_WEB_CONFIGS.some((c) => c.configured);

export const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:18080";
// The withdrawal-signal address on every vampchain: sending native currency
// here signals "I want to withdraw." Deliberately the treasury account
// itself, not a real dead address — recaptured, not destroyed. See
// "Withdrawal signal: recapture, not destroy" in docs/ARCHITECTURE.md. Same
// address regardless of which home chain a vampchain was spawned from.
export const BURN_ADDRESS =
  (process.env.NEXT_PUBLIC_BURN_ADDRESS as Address | undefined) ?? ("0x12f5B89B02C8107278c5F24E74d7B44267C55d1f" as Address);

// Public by design — WalletConnect project IDs identify the dapp to the
// relay network, they aren't secret. Unset in local dev is fine: wagmiConfig
// just skips adding the walletConnect connector and falls back to injected-only.
export const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
