import { createPublicClient, defineChain, http, type PublicClient } from "viem";

export const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:18080";

/// Builds a viem client pointed at a single vampchain through the public
/// rpc-gateway — never a raw internal rpcUrl (this app runs on Vercel,
/// which can't reach Fly's `.internal` addresses anyway, same reason
/// web/'s ExplorerPanel does this). Deliberately callable from client
/// components: the gateway's rate limiter is keyed per visitor IP, which
/// only holds up if every visitor's browser talks to it directly rather
/// than funneling through this app's own server (which would collapse
/// every visitor onto Vercel's small pool of outbound IPs and share one
/// rate-limit bucket for the whole site). Every RPC-backed page in this
/// app must call this from a "use client" component, never a server
/// component — see docs/ARCHITECTURE.md's rpc-gateway section.
export function getChainClient(evmChainId: bigint | string): PublicClient {
  const id = typeof evmChainId === "string" ? BigInt(evmChainId) : evmChainId;
  const chain = defineChain({
    id: Number(id),
    name: `vampchain-${id}`,
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [`${GATEWAY_URL}/rpc/${id}`] } },
  });
  return createPublicClient({ chain, transport: http(`${GATEWAY_URL}/rpc/${id}`) });
}
