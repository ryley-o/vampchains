import { formatDuration } from "@/lib/format";

const YEAR = 365n * 86_400n;
const MAX_UINT256 = (1n << 256n) - 1n;

/// A chain is a living thing until its funding runs out — this reads like
/// a vital sign, not a generic progress bar. Scaled against one year of
/// runway (the annual fee's own unit), capped visually at full for
/// free/forever chains.
export function RunwayMeter({ remainingRuntime, active }: { remainingRuntime: bigint; active: boolean }) {
  const isForever = remainingRuntime >= MAX_UINT256 / 2n;
  const pct = isForever ? 100 : Math.max(0, Math.min(100, Number((remainingRuntime * 100n) / YEAR)));
  const critical = !isForever && pct < 15;

  return (
    <div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-charcoal-soft">
        <div
          className={`h-full rounded-full transition-[width] duration-700 ${
            !active
              ? "bg-bone-dim/30"
              : critical
                ? "animate-heartbeat bg-blood-bright"
                : "bg-blood"
          }`}
          style={{ width: `${active ? Math.max(pct, 3) : 0}%` }}
        />
      </div>
      <p className="mt-1.5 font-mono text-[11px] uppercase tracking-wider text-bone-dim/70">
        {active ? `${formatDuration(remainingRuntime)} runway` : "flatlined"}
      </p>
    </div>
  );
}
