import { type Account, type Chain, createWalletClient, defineChain, http } from "viem";

export function makeL1Chain(chainId: number, rpcUrl: string): Chain {
  return defineChain({
    id: chainId,
    name: "vampchains-l1",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

export function makeL1WalletClient(account: Account, chainId: number, rpcUrl: string) {
  return createWalletClient({ account, chain: makeL1Chain(chainId, rpcUrl), transport: http(rpcUrl) });
}

export type L1WalletClient = ReturnType<typeof makeL1WalletClient>;
