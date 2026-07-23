import "server-only";
import { type Address, parseAbiItem } from "viem";
import { getHomePublicClient } from "./viemClients";
import { ERC20_ABI } from "./erc20Abi";
import { getHomeChainWebConfig } from "./contracts";

/// How much of `baseToken` the runway treasury currently holds on
/// `homeChainId`, awaiting manual conversion + `topUp` (see
/// VampChainRegistry.runwayTreasury's docstring — this is a best-effort,
/// protocol-discretion process, not an on-chain guarantee, which is exactly
/// why this balance is a plain public ERC20 read anyone can verify
/// independently rather than a number the protocol merely claims).
export async function getRunwayTreasuryBalance(
  homeChainId: number,
  baseToken: Address,
  runwayTreasury: Address
): Promise<bigint> {
  try {
    return (await getHomePublicClient(homeChainId).readContract({
      address: baseToken,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [runwayTreasury],
    })) as bigint;
  } catch {
    return 0n;
  }
}

const TOPPED_UP_EVENT = parseAbiItem(
  "event ToppedUp(uint256 indexed chainId, address indexed from, uint256 amount, uint256 newBalance)"
);

/// Total USDC the runway treasury has actually turned into top-ups for this
/// chain so far — read directly from the registry's own `ToppedUp` event
/// log (filtered by `chainId` and `from`), not from any off-chain ledger,
/// for the same reason `getRunwayTreasuryBalance` is a live read: this is
/// meant to be independently checkable, not merely asserted. There's
/// deliberately no persisted index for this — it's a rare, small-volume
/// event per chain, so a live `getLogs` scan on page load is simpler than
/// standing up a dedicated watcher for it.
export async function getRunwayDeliveredTotal(homeChainId: number, chainId: bigint, runwayTreasury: Address): Promise<bigint> {
  const cfg = getHomeChainWebConfig(homeChainId);
  if (!cfg || !cfg.configured) return 0n;
  try {
    const logs = await getHomePublicClient(homeChainId).getLogs({
      address: cfg.registryAddress,
      event: TOPPED_UP_EVENT,
      args: { chainId, from: runwayTreasury },
      fromBlock: "earliest",
      toBlock: "latest",
    });
    return logs.reduce((sum, log) => sum + log.args.amount!, 0n);
  } catch {
    return 0n;
  }
}
