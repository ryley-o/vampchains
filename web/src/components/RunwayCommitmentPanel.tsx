import "server-only";
import type { Address } from "viem";
import { getRunwayDeliveredTotal, getRunwayTreasuryBalance } from "@/lib/runwayReads";
import { formatTokenAmount, formatUsdc } from "@/lib/format";
import { AddressChip } from "@/components/AddressChip";

/// Shows exactly what the "runway third" of gas-fee revenue (see
/// VampBridge.sol's three-way split) has actually done for this chain —
/// deliberately built from two independently-verifiable public facts
/// rather than an off-chain claim about intent, since the whole reason
/// runwayTreasury is a separate wallet from protocolTreasury is so this
/// can be checked, not just trusted:
///   - "pending" = a live ERC20 balanceOf read on the runway treasury
///     itself — funds already earmarked, awaiting manual conversion +
///     topUp (best-effort, at the protocol's discretion, see
///     VampChainRegistry.runwayTreasury's docstring).
///   - "delivered" = the sum of this chain's own FundingEvent rows where
///     the top-up's actor was the runway treasury address — i.e. already
///     turned into real runway, indexed the exact same way any other
///     top-up is.
export async function RunwayCommitmentPanel({
  chainId,
  homeChainId,
  baseToken,
  symbol,
  runwayTreasury,
}: {
  chainId: bigint;
  homeChainId: number;
  baseToken: Address;
  symbol: string;
  runwayTreasury: Address;
}) {
  const [pending, delivered] = await Promise.all([
    getRunwayTreasuryBalance(homeChainId, baseToken, runwayTreasury),
    getRunwayDeliveredTotal(homeChainId, chainId, runwayTreasury),
  ]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <p className="text-sm text-bone-dim/60">
          A third of every gas-fee claim on this chain goes to a dedicated runway wallet{" "}
          <AddressChip address={runwayTreasury} className="text-bone-dim" />, separate from the protocol&apos;s
          own share — earmarked to be converted to USDC and topped back into this chain&apos;s funding, on a
          best-effort basis.
        </p>
      </div>
      <div className="flex gap-6">
        <div>
          <p className="text-xs text-bone-dim/50">Pending conversion</p>
          <p className="mt-1 font-mono text-lg text-bone">
            {formatTokenAmount(pending, 18)} <span className="text-sm text-bone-dim/50">${symbol}</span>
          </p>
        </div>
        <div>
          <p className="text-xs text-bone-dim/50">Delivered as runway</p>
          <p className="mt-1 font-mono text-lg text-emerald-300">${formatUsdc(delivered)}</p>
        </div>
      </div>
    </div>
  );
}
