type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function getInjectedProvider(): EthereumProvider | undefined {
  return (window as unknown as { ethereum?: EthereumProvider }).ethereum;
}

/// Deliberately not wagmi — scan/ has no wallet-connect infra at all (this
/// is its first write-capable feature), and pulling in a full connector
/// stack for "connect + switch chain + send one write tx" would be a lot
/// of weight for what's still a small, mostly-read app. Same reasoning
/// web/'s AddToWalletButton already uses: every injected wallet speaks
/// these EIP-1193/3085/3326 methods the same standard way.
export async function connectInjectedWallet(): Promise<`0x${string}`> {
  const ethereum = getInjectedProvider();
  if (!ethereum) throw new Error("No browser wallet found — open this page inside your wallet's own browser instead.");
  const accounts = (await ethereum.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts[0]) throw new Error("No account returned by wallet.");
  return accounts[0] as `0x${string}`;
}

export function getInjectedEthereum(): EthereumProvider {
  const ethereum = getInjectedProvider();
  if (!ethereum) throw new Error("No browser wallet found.");
  return ethereum;
}

/// Switches to the vampchain, adding it first if the wallet doesn't know it
/// yet (error code 4902) — same chainlist.org-style shape as
/// AddToWalletButton, just inlined here since a write has to be on the
/// right chain before it can be submitted at all, not left to chance.
export async function ensureWalletOnChain(
  ethereum: EthereumProvider,
  evmChainId: string,
  chainName: string,
  chainSymbol: string,
  rpcUrl: string
): Promise<void> {
  const hexId = `0x${BigInt(evmChainId).toString(16)}`;
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err ? (err as { code: unknown }).code : undefined;
    if (code === 4902) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: hexId,
            chainName: `${chainName} (Vampchain)`,
            nativeCurrency: { name: chainSymbol, symbol: chainSymbol, decimals: 18 },
            rpcUrls: [rpcUrl],
          },
        ],
      });
    } else {
      throw err;
    }
  }
}
