import type { Address } from "viem";
import { createPublicClient, getAddress, http } from "viem";
import type { privateKeyToAccount } from "viem/accounts";
import type { Chain as ChainRow } from "@vampchains/db";
import { prisma } from "@vampchains/db";
import { signClaim } from "./eip712.js";
import { scaleFromNativeUnits } from "./units.js";

type SigningAccount = ReturnType<typeof privateKeyToAccount>;

/// Scans a single vampchain's blocks for plain-value transfers to the burn
/// address (the sidechain "withdraw" gesture: send native currency there to
/// redeem the locked base token back on L1) and, for each one found, signs
/// an EIP-712 claim the recipient can submit to VampBridge.claim()
/// themselves. No L1 transaction, no gas spent by us — see docs/ARCHITECTURE.md
/// for why this replaced the original push-based `release()` design.
///
/// A burn *from* the chain's own shared Clique signer/etherbase address
/// should never happen anymore — the signer accumulates tip revenue and
/// nothing spends from it (fee revenue is claimed as pure accounting via
/// VampBridge.claimFeeRevenue, see gasContributionWatcher.ts and
/// docs/ARCHITECTURE.md "Protocol fee revenue"). If one ever IS seen
/// (leftover old-design sweep, manual operation), signing a user claim
/// payable to the signer address would be wrong, so it's loudly skipped
/// instead.
///
/// Runs even against a chain the registry has since marked inactive —
/// claim() intentionally doesn't check chain-active status, see
/// VampBridge.sol's docs.
///
/// Deliberately does NOT apply a confirmation delay here the way the L1
/// watchers do — a vampchain is a single-signer Clique node with no other
/// validators, so there's no reorg risk to wait out. Waiting for
/// confirmations on a low-traffic chain that only mines a block per tx can
/// stall forever (confirmations never accrue without new activity).
export async function pollWithdrawals(
  chain: ChainRow,
  signingAccount: SigningAccount,
  l1ChainId: number,
  bridgeAddress: Address,
  burnAddress: Address,
  cliqueSignerAddress: Address
) {
  if (!chain.rpcUrl) return;
  const sideClient = createPublicClient({ transport: http(chain.rpcUrl) });

  const cursorId = `sidechain-burns-${chain.chainId}`;
  const cursor = await prisma.indexerCursor.upsert({
    where: { id: cursorId },
    update: {},
    create: { id: cursorId, lastBlock: 0n },
  });

  const safeLatest = await sideClient.getBlockNumber();
  const fromBlock = cursor.lastBlock + 1n;
  if (fromBlock > safeLatest) return;

  for (let blockNumber = fromBlock; blockNumber <= safeLatest; blockNumber++) {
    const block = await sideClient.getBlock({ blockNumber, includeTransactions: true });
    for (const tx of block.transactions) {
      if (typeof tx === "string") continue; // shouldn't happen with includeTransactions: true
      if (tx.to && getAddress(tx.to) === burnAddress && tx.value > 0n) {
        if (getAddress(tx.from) === cliqueSignerAddress) {
          // See module docstring — never sign a user claim payable to the
          // protocol's own signer address.
          console.warn(
            `[withdrawals] ignoring burn from the Clique signer address on chain ${chain.chainId} (tx ${tx.hash}) — sweeps no longer exist, this should not happen`
          );
          continue;
        }
        await handleBurn(chain, tx.hash, tx.from, tx.value, blockNumber, signingAccount, l1ChainId, bridgeAddress);
      }
    }
  }

  await prisma.indexerCursor.update({ where: { id: cursorId }, data: { lastBlock: safeLatest } });
}

async function handleBurn(
  chain: ChainRow,
  sidechainTxHash: `0x${string}`,
  from: Address,
  nativeAmount: bigint,
  sidechainBlock: bigint,
  signingAccount: SigningAccount,
  l1ChainId: number,
  bridgeAddress: Address
) {
  const existing = await prisma.withdrawalEvent.findUnique({ where: { sidechainTxHash } });
  if (existing?.signature) return;

  // A user withdrawal is a one-off, deliberate action on their own funds —
  // there's no ongoing per-chain stream to accumulate this into if it
  // rounds to zero, so this stays a hard drop (with a clear warning)
  // rather than silently holding their funds pending some future top-up
  // they didn't ask for.
  const amount = scaleFromNativeUnits(nativeAmount, chain.baseTokenDecimals);
  if (amount === 0n) {
    console.warn(
      `[withdrawals] burn of ${nativeAmount} native wei on chain ${chain.chainId} rounds to 0 raw ${chain.baseTokenSymbol} units (${chain.baseTokenDecimals} decimals) — below the minimum representable amount, nothing to claim`
    );
    return;
  }

  const signature = await signClaim(signingAccount, {
    l1ChainId,
    bridgeAddress,
    claim: { vampChainId: chain.chainId, to: from, amount, sidechainTxHash },
  });

  await prisma.withdrawalEvent.upsert({
    where: { sidechainTxHash },
    update: { signature },
    create: {
      chainDbId: chain.id,
      chainId: chain.chainId,
      sidechainTxHash,
      sidechainBlock,
      to: from,
      amount: amount.toString(),
      signature,
    },
  });

  console.log(
    `[withdrawals] signed user claim for ${amount} raw units (from ${from}) on chain ${chain.chainId} (sidechain tx ${sidechainTxHash})`
  );
}
