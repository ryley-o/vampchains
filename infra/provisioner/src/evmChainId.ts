import { randomInt } from "node:crypto";

/// Every vampchain needs its own EVM chain id — the number a wallet like
/// MetaMask uses to distinguish it from every other network that exists,
/// anywhere. Two failure modes matter here, and they need two different
/// defenses:
///
/// 1. Internal collision (two vampchains landing on the same id) — solved
///    with mathematical certainty by `Chain.evmChainId`'s DB-level unique
///    constraint (see `nextEvmChainId` below): a conflicting insert simply
///    fails and gets retried with a fresh draw, so this can never actually
///    happen regardless of how many provisioners (one per home chain,
///    eventually) are creating chains concurrently.
/// 2. External collision (our id happening to match some unrelated real
///    chain already in use somewhere) — this is the one that actually
///    matters and can't be solved by our own uniqueness guarantee alone.
///    Chain-id squatting/collision is a real, recurring problem in the EVM
///    ecosystem (it's why chainlist.org/ethereum-lists exist as a
///    coordination point at all). A small sequential range walking
///    upward from an arbitrary base — the previous `900_000n + registryChainId`
///    scheme — is exactly the wrong shape: it's fully predictable, and
///    "small round numbers" are precisely where other private/test chains
///    also tend to land (1337, 31337, and neighborhoods like our own old
///    900000s are exactly the kind of range other projects independently
///    pick too).
///
/// The fix: draw uniformly at random from a wide range instead.
///  - Lower bound 10,000,000 clears essentially every real, registered
///    chain id in use today, and every common "vanity"/dev-chain id.
///  - Upper bound 2^31 keeps every id representable as a signed 32-bit
///    integer — the practical safe ceiling for broad wallet/tooling
///    compatibility (some older EVM libraries and a few real historical
///    wallet bugs choke on chain ids that don't fit cleanly in 32 bits;
///    values need not be *this* conservative to be spec-legal, but there's
///    no reason to test that boundary for a chain id nobody needs to be
///    memorable or small).
///  - With only a few thousand real chain ids in existence against a
///    ~2.1 billion-wide random space, accidental collision with any
///    specific existing chain is statistically negligible — nobody
///    benefits from predicting a vampchain's future id in advance either,
///    so a plain CSPRNG draw (not derived from anything on-chain) is the
///    right tool, no commit-reveal or VRF complexity needed.
const MIN_EVM_CHAIN_ID = 10_000_000;
const MAX_EVM_CHAIN_ID = 2 ** 31; // exclusive upper bound

export function generateEvmChainIdCandidate(): bigint {
  return BigInt(randomInt(MIN_EVM_CHAIN_ID, MAX_EVM_CHAIN_ID));
}
