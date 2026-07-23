import "server-only";
import { prisma } from "@vampchains/db";
import { formatTokenAmount, shortAddress } from "@/lib/format";

/// "Blood given" leaderboard for one chain — top addresses by real gas
/// spent (tip + burned base fee both, everything a wallet actually paid),
/// indexed by the relayer's gasContributionWatcher.ts on a slow (default
/// daily) cadence. Purely informational: no claim, no payout, just public
/// credit for keeping a chain alive by using it.
export async function BloodDonorsPanel({
  chainDbId,
  symbol,
  limit = 10,
}: {
  chainDbId: number;
  symbol: string;
  limit?: number;
}) {
  const rows = await prisma.gasContribution.findMany({ where: { chainDbId } });
  const top = rows
    .map((r) => ({ address: r.address, amount: BigInt(r.totalGasSpentNativeWei) }))
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0))
    .slice(0, limit);

  if (top.length === 0) {
    return <p className="text-sm text-bone-dim/50">No blood given here yet — be the first to use this chain.</p>;
  }

  return (
    <ol className="space-y-2">
      {top.map((row, i) => (
        <li
          key={row.address}
          className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-charcoal-soft/40 px-4 py-2.5"
        >
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-bone-dim/40">#{i + 1}</span>
            <span className="font-mono text-sm text-bone">{shortAddress(row.address)}</span>
          </div>
          <span className="font-mono text-sm text-blood-bright">
            {formatTokenAmount(row.amount, 18)} <span className="text-bone-dim/50">${symbol}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
