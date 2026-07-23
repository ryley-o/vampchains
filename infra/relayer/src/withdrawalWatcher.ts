import type { Address } from "viem";
import { createPublicClient, getAddress, http } from "viem";
import type { privateKeyToAccount } from "viem/accounts";
import type { Chain as ChainRow } from "@vampchains/db";
import { prisma } from "@vampchains/db";
import { signClaim, signClaimSwept } from "./eip712.js";
import { scaleFromNativeUnits, scaleToNativeUnits } from "./units.js";

type SigningAccount = ReturnType<typeof privateKeyToAccount>;

/// Scans a single vampchain's blocks for plain-value transfers to the burn
/// address (the sidechain "withdraw" gesture: send native currency there to
/// redeem the locked base token back on L1) and, for each one found, signs
/// an EIP-712 claim the recipient can submit to VampBridge.claim()
/// themselves. No L1 transaction, no gas spent by us — see docs/ARCHITECTURE.md
/// for why this replaced the original push-based `release()` design.
///
/// A burn *from* the chain's own shared Clique signer/etherbase address
/// (`cliqueSignerAddress`) is treated as swept protocol fee revenue, not a
/// user withdrawal — see feeSweep.ts, which is what actually produces these
/// burns (an admin-triggered `eth_sendTransaction` against the vampchain's
/// own unlocked signer account). Those get a `ClaimSwept` attestation
/// instead of a plain `Claim`, split three ways between the protocol
/// treasury, the chain's creator, and the runway treasury on-chain — see
/// docs/ARCHITECTURE.md "Protocol fee revenue".
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
        const isFeeSweep = getAddress(tx.from) === cliqueSignerAddress;
        await handleBurn(
          chain,
          tx.hash,
          tx.from,
          tx.value,
          blockNumber,
          isFeeSweep,
          signingAccount,
          l1ChainId,
          bridgeAddress
        );
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
  isFeeSweep: boolean,
  signingAccount: SigningAccount,
  l1ChainId: number,
  bridgeAddress: Address
) {
  const existing = await prisma.withdrawalEvent.findUnique({ where: { sidechainTxHash } });
  if (existing?.signature) return;

  if (isFeeSweep) {
    await handleFeeSweepBurn(chain, sidechainTxHash, from, nativeAmount, sidechainBlock, signingAccount, l1ChainId, bridgeAddress);
    return;
  }

  // A user withdrawal is a one-off, deliberate action on their own funds —
  // unlike a protocol fee sweep, there's no ongoing per-chain stream to
  // accumulate this into if it rounds to zero, so this stays a hard drop
  // (with a clear warning) rather than silently holding their funds
  // pending some future top-up they didn't ask for.
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
      kind: "USER",
      signature,
    },
  });

  console.log(
    `[withdrawals] signed user claim for ${amount} raw units (from ${from}) on chain ${chain.chainId} (sidechain tx ${sidechainTxHash})`
  );
}

/// A fee sweep is a real one-shot burn transaction each time (unlike
/// base-fee-burn tracking, which is pure accounting with nothing to
/// physically move — see baseFeeWatcher.ts), so its native-wei amount
/// might not convert to even 1 raw base-token unit on its own — common for
/// a low-decimal token against the sweep dust threshold. Rather than
/// stranding that value forever (the previous behavior: drop it with a
/// console warning, no way to ever recover it), accumulate it into
/// `Chain.unclaimedSweptNativeWei` and only sign a `ClaimSwept` once the
/// cumulative total actually clears one raw unit — same discipline
/// baseFeeWatcher.ts already uses for base-fee burn. The attestation's
/// `sidechainTxHash` is always *this* sweep's hash, the one that pushed
/// the cumulative total over the threshold — VampBridge's `claimed`
/// mapping is keyed by that hash and each one can only ever be used once,
/// regardless of how many earlier sweeps contributed dust toward it.
/// Updating the ledger and creating the claim happen in one transaction —
/// otherwise a crash between the two could either double-count this
/// sweep's contribution on retry, or lose it outright.
async function handleFeeSweepBurn(
  chain: ChainRow,
  sidechainTxHash: `0x${string}`,
  from: Address,
  nativeAmount: bigint,
  sidechainBlock: bigint,
  signingAccount: SigningAccount,
  l1ChainId: number,
  bridgeAddress: Address
) {
  const newUnclaimedTotal = BigInt(chain.unclaimedSweptNativeWei) + nativeAmount;
  const amount = scaleFromNativeUnits(newUnclaimedTotal, chain.baseTokenDecimals);

  if (amount === 0n) {
    await prisma.chain.update({
      where: { id: chain.id },
      data: { unclaimedSweptNativeWei: newUnclaimedTotal.toString() },
    });
    console.log(
      `[withdrawals] fee-sweep of ${nativeAmount} native wei on chain ${chain.chainId} still below 1 raw ${chain.baseTokenSymbol} unit (${chain.baseTokenDecimals} decimals) — accumulated to ${newUnclaimedTotal} native wei, deferred to a future sweep`
    );
    return;
  }

  // Only the portion that actually converts is claimed; whatever's left
  // over (necessarily less than one raw unit) carries forward.
  const remainder = newUnclaimedTotal - scaleToNativeUnits(amount, chain.baseTokenDecimals);

  const signature = await signClaimSwept(signingAccount, {
    l1ChainId,
    bridgeAddress,
    claim: { vampChainId: chain.chainId, amount, sidechainTxHash },
  });

  await prisma.$transaction([
    prisma.chain.update({ where: { id: chain.id }, data: { unclaimedSweptNativeWei: remainder.toString() } }),
    prisma.withdrawalEvent.upsert({
      where: { sidechainTxHash },
      update: { signature },
      create: {
        chainDbId: chain.id,
        chainId: chain.chainId,
        sidechainTxHash,
        sidechainBlock,
        to: from,
        amount: amount.toString(),
        kind: "FEE_SWEEP",
        signature,
      },
    }),
  ]);

  console.log(
    `[withdrawals] signed swept-fee claim for ${amount} raw units on chain ${chain.chainId} (sidechain tx ${sidechainTxHash}, ${remainder} native wei carried forward)`
  );
}
