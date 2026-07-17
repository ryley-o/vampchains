import { createPublicClient, defineChain, http } from "viem";
import { L1_CHAIN_ID, L1_RPC_URL } from "./contracts";

export const l1Chain = defineChain({
  id: L1_CHAIN_ID,
  name: "vampchains-l1",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [L1_RPC_URL] } },
});

export const l1PublicClient = createPublicClient({ chain: l1Chain, transport: http(L1_RPC_URL) });

export function makeVampchainChain(evmChainId: bigint, symbol: string, gatewayChainId: bigint) {
  return defineChain({
    id: Number(evmChainId),
    name: `vampchain-${gatewayChainId}`,
    nativeCurrency: { name: symbol, symbol, decimals: 18 },
    rpcUrls: { default: { http: [`${process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:18080"}/rpc/${gatewayChainId}`] } },
  });
}
