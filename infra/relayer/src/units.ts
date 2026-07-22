/// Native currency on every vampchain is always treated as 18-decimal, the
/// same as ETH — that's what wallets/tooling assume for any EVM chain's
/// native asset, regardless of what the underlying base token's own
/// `decimals()` says. Most real ERC20s are NOT 18 decimals (USDC/USDT are
/// 6), so a raw unit-for-unit mint would be off by orders of magnitude —
/// e.g. depositing 100 USDC (100_000_000 raw units) would mint a balance
/// that displays as 0.0000000000001 in any wallet instead of 100. Scale up
/// to 18-decimal terms so the native balance always displays correctly.
export function scaleToNativeUnits(rawAmount: bigint, tokenDecimals: number): bigint {
  if (tokenDecimals > 18) {
    throw new Error(`base token has ${tokenDecimals} decimals; only tokens with <= 18 decimals are supported`);
  }
  return rawAmount * 10n ** BigInt(18 - tokenDecimals);
}

/// Inverse of scaleToNativeUnits — convert a native (18-decimal) amount back
/// to the base token's own raw units, e.g. for an L1 claim. Floors on
/// precision loss: an amount that isn't an exact multiple of
/// 10^(18-decimals) loses the remainder as unclaimable dust (documented,
/// not silently wrong — see docs/ARCHITECTURE.md).
export function scaleFromNativeUnits(nativeAmount: bigint, tokenDecimals: number): bigint {
  if (tokenDecimals > 18) {
    throw new Error(`base token has ${tokenDecimals} decimals; only tokens with <= 18 decimals are supported`);
  }
  return nativeAmount / 10n ** BigInt(18 - tokenDecimals);
}
