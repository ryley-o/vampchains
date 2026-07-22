import { getAddress } from "viem";

// Chains covered by the Trust Wallet open asset repo, keyed by EVM chain id.
// Only real, listed mainnet tokens show up here — testnets never will, which
// is fine, that's what the identicon fallback is for.
const TRUST_WALLET_CHAIN_SLUGS: Record<number, string> = {
  8453: "base",
};

/// Best-effort logo URL for a real, listed token. Returns undefined when the
/// chain isn't covered (e.g. any testnet) — callers should fall back to
/// `identiconUrl`, and the image itself may still 404 if this particular
/// token was never submitted to the asset repo.
export function trustWalletLogoUrl(chainId: number, address: string): string | undefined {
  const slug = TRUST_WALLET_CHAIN_SLUGS[chainId];
  if (!slug) return undefined;
  try {
    return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${slug}/assets/${getAddress(address)}/logo.png`;
  } catch {
    return undefined;
  }
}

/// Deterministic generated avatar, keyed by address — same token always
/// renders the same image, works for every token including ones minted five
/// seconds ago on a testnet. No API key, no rate limit that matters here.
export function identiconUrl(seed: string): string {
  return `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(seed.toLowerCase())}&backgroundType=gradientLinear`;
}
