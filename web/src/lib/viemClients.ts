import { type Chain, type PublicClient, createPublicClient, defineChain, http } from "viem";
import { GATEWAY_URL, HOME_CHAIN_WEB_CONFIGS, type HomeChainWebConfig } from "./contracts";

function defineHomeChain(cfg: HomeChainWebConfig): Chain {
  return defineChain({
    id: cfg.homeChainId,
    name: cfg.name,
    nativeCurrency: { name: cfg.nativeCurrencySymbol, symbol: cfg.nativeCurrencySymbol, decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
    testnet: cfg.isTestnet,
  });
}

/// One viem `Chain` per home chain, in the same order as
/// `HOME_CHAIN_WEB_CONFIGS` — the full set wagmi needs in its `chains`
/// array so a connected wallet can be switched to any of the three.
export const HOME_VIEM_CHAINS: [Chain, ...Chain[]] = HOME_CHAIN_WEB_CONFIGS.map(defineHomeChain) as [Chain, ...Chain[]];

const homeChainsById = new Map(HOME_VIEM_CHAINS.map((chain) => [chain.id, chain]));
const homePublicClientsById = new Map<number, PublicClient>();

export function getHomeViemChain(homeChainId: number): Chain {
  const chain = homeChainsById.get(homeChainId);
  if (!chain) throw new Error(`unknown home chain id: ${homeChainId}`);
  return chain;
}

/// Lazily built, cached per home chain — server components read from
/// several of these per request (registryReads.ts, bridgeReads.ts), so
/// there's no reason to recreate a client per call.
export function getHomePublicClient(homeChainId: number): PublicClient {
  let client = homePublicClientsById.get(homeChainId);
  if (!client) {
    const chain = getHomeViemChain(homeChainId);
    client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) });
    homePublicClientsById.set(homeChainId, client);
  }
  return client;
}

export function makeVampchainChain(evmChainId: bigint, symbol: string) {
  return defineChain({
    id: Number(evmChainId),
    name: `vampchain-${evmChainId}`,
    nativeCurrency: { name: symbol, symbol, decimals: 18 },
    rpcUrls: { default: { http: [`${GATEWAY_URL}/rpc/${evmChainId}`] } },
  });
}
