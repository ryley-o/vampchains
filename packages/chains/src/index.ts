/// The exact set of home chains this deployment supports — hardcoded on
/// purpose. This isn't a generic "add any chain" system; it's three
/// specific, deliberately chosen chains (Base, Ethereum mainnet's testnet,
/// and Robinhood Chain), and every service in this repo imports this same
/// list rather than each keeping its own copy. Real per-deployment values
/// (RPC provider URLs, contract addresses, private keys) still come from
/// env vars per service, same as before — this package only holds the
/// static identity info that's the same everywhere: which chains exist,
/// their ids, and their public fallback endpoints.
///
/// All three are currently testnets, deliberately — see
/// docs/ARCHITECTURE.md "Multi-chain" for why: this is genuinely new,
/// unproven infrastructure (multi-home-chain routing, per-chain relayer
/// keys, the whole topology), and bugs here are cheap to catch on a
/// testnet and expensive — real funds, the single-relayer-key trust model
/// — to catch in prod. Move each chain to its mainnet counterpart
/// independently once it's proven, rather than all at once.
export type HomeChainKey = "base" | "ethereum" | "robinhood";

export interface HomeChainInfo {
  key: HomeChainKey;
  /// The home chain's own EVM chain id — NOT a vampchain id. Matches
  /// `Chain.homeChainId` in the database.
  id: number;
  name: string;
  isTestnet: boolean;
  nativeCurrencySymbol: string;
  /// A public fallback RPC endpoint — fine as a default and for
  /// client-side wallet/chain definitions, but every service here takes
  /// its own real RPC URL via env config (a paid provider, not this) for
  /// anything that actually matters (indexing, submitting transactions).
  publicRpcUrl: string;
  blockExplorerUrl: string;
}

export const HOME_CHAINS: readonly HomeChainInfo[] = [
  {
    key: "base",
    id: 84532,
    name: "Base Sepolia",
    isTestnet: true,
    nativeCurrencySymbol: "ETH",
    publicRpcUrl: "https://sepolia.base.org",
    blockExplorerUrl: "https://sepolia.basescan.org",
  },
  {
    key: "ethereum",
    id: 11155111,
    name: "Ethereum Sepolia",
    isTestnet: true,
    nativeCurrencySymbol: "ETH",
    publicRpcUrl: "https://rpc.sepolia.org",
    blockExplorerUrl: "https://sepolia.etherscan.io",
  },
  {
    key: "robinhood",
    id: 46630,
    name: "Robinhood Chain Testnet",
    isTestnet: true,
    nativeCurrencySymbol: "ETH",
    publicRpcUrl: "https://rpc.testnet.chain.robinhood.com",
    blockExplorerUrl: "https://explorer.testnet.chain.robinhood.com",
  },
] as const;

export function getHomeChainById(id: number): HomeChainInfo | undefined {
  return HOME_CHAINS.find((c) => c.id === id);
}

export function requireHomeChainById(id: number): HomeChainInfo {
  const chain = getHomeChainById(id);
  if (!chain) throw new Error(`unknown home chain id: ${id}`);
  return chain;
}

export function getHomeChainByKey(key: HomeChainKey): HomeChainInfo {
  const chain = HOME_CHAINS.find((c) => c.key === key);
  if (!chain) throw new Error(`unknown home chain key: ${key}`);
  return chain;
}
