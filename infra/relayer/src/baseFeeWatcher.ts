import type { Address } from "viem";
import { createPublicClient, http } from "viem";
import type { privateKeyToAccount } from "viem/accounts";
import type { Chain as ChainRow } from "@vampchains/db";
import { prisma } from "@vampchains/db";
import { signBurnedFees } from "./eip712.js";
import { scaleFromNativeUnits } from "./units.js";

type SigningAccount = ReturnType<typeof privateKeyToAccount>;

/// Walks a vampchain's block headers to track cumulative EIP-1559 base-fee
/// burn (`baseFeePerGas * gasUsed`, summed block by block) — the accounting
/// the protocol claims against via VampBridge.claimBurnedFees, split three
/// ways with the chain's creator and the runway treasury. See
/// docs/ARCHITECTURE.md "Protocol fee revenue" for why this is a real, exact
/// L1-side surplus rather than an approximation: base fee is the only thing
/// that ever destroys a vampchain's native currency supply, so
/// `lockedBalance` on L1 ends up
/// exceeding real circulating supply by exactly this cumulative total.
///
/// Keeps the exact running total in native 18-decimal wei
/// (`cumulativeBaseFeeBurnedNativeWei`) and only scales down to the base
/// token's own raw decimal units (`cumulativeBaseFeeBurned`, what the claim
/// actually pays out) from that full total each time — never incrementally
/// from a single tick's burn — so per-tick rounding dust can't compound
/// over thousands of polls.
///
/// Re-signs a fresh attestation every time the scaled total changes and
/// stores it directly on the Chain row — infra/rpc-gateway serves it at
/// GET /fees/:chainId. Signing costs nothing (no transaction, no gas), so
/// there's no reason to throttle this beyond the normal relayer poll
/// cadence.
export async function trackBurnedFees(
  chain: ChainRow,
  signingAccount: SigningAccount,
  l1ChainId: number,
  bridgeAddress: Address
) {
  if (!chain.rpcUrl) return;
  const sideClient = createPublicClient({ transport: http(chain.rpcUrl) });

  const safeLatest = await sideClient.getBlockNumber();
  const fromBlock = chain.baseFeeScanBlock + 1n;
  if (fromBlock > safeLatest) return;

  let burnedThisTick = 0n;
  for (let blockNumber = fromBlock; blockNumber <= safeLatest; blockNumber++) {
    const block = await sideClient.getBlock({ blockNumber });
    if (block.baseFeePerGas) {
      burnedThisTick += block.baseFeePerGas * block.gasUsed;
    }
  }

  if (burnedThisTick === 0n) {
    await prisma.chain.update({ where: { id: chain.id }, data: { baseFeeScanBlock: safeLatest } });
    return;
  }

  const newNativeWeiTotal = BigInt(chain.cumulativeBaseFeeBurnedNativeWei) + burnedThisTick;
  const newRawTotal = scaleFromNativeUnits(newNativeWeiTotal, chain.baseTokenDecimals);
  const previousRawTotal = BigInt(chain.cumulativeBaseFeeBurned);

  // Only worth re-signing (and re-writing) if the raw-unit figure actually
  // moved — a chain whose base token has few decimals can go many ticks
  // between one raw unit's worth of native-wei burn accruing.
  if (newRawTotal === previousRawTotal) {
    await prisma.chain.update({
      where: { id: chain.id },
      data: { baseFeeScanBlock: safeLatest, cumulativeBaseFeeBurnedNativeWei: newNativeWeiTotal.toString() },
    });
    return;
  }

  const signature = await signBurnedFees(signingAccount, {
    l1ChainId,
    bridgeAddress,
    claim: { vampChainId: chain.chainId, cumulativeBurned: newRawTotal, asOfBlock: safeLatest },
  });

  await prisma.chain.update({
    where: { id: chain.id },
    data: {
      baseFeeScanBlock: safeLatest,
      cumulativeBaseFeeBurnedNativeWei: newNativeWeiTotal.toString(),
      cumulativeBaseFeeBurned: newRawTotal.toString(),
      baseFeeAttestationSignature: signature,
      baseFeeAttestedAt: new Date(),
    },
  });

  console.log(
    `[base-fee] chain ${chain.chainId}: cumulative burn now ${newRawTotal} raw units as of block ${safeLatest} (attestation refreshed)`
  );
}
