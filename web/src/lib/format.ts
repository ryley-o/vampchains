import { formatUnits } from "viem";

export function formatUsdc(amount: bigint, decimals = 6): string {
  const n = Number(formatUnits(amount, decimals));
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatTokenAmount(amount: bigint, decimals: number): string {
  const n = Number(formatUnits(amount, decimals));
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

const MAX_UINT256 = (1n << 256n) - 1n;

export function formatDuration(seconds: bigint): string {
  if (seconds >= MAX_UINT256 / 2n) return "forever (no fee)";
  if (seconds <= 0n) return "depleted";

  const days = seconds / 86_400n;
  if (days >= 365n) {
    const years = Number(seconds) / (365 * 86_400);
    return `${years.toFixed(1)} years`;
  }
  if (days >= 1n) return `${days} day${days === 1n ? "" : "s"}`;

  const hours = seconds / 3600n;
  return `${hours} hour${hours === 1n ? "" : "s"}`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
