import { type Address, type Hex, getAddress, isHex } from "viem";
import { HOME_CHAINS, type HomeChainKey } from "@vampchains/chains";

/// Per-home-chain runtime config — everything the relayer needs to watch
/// and sign claims against *one* of the three home chains' VampBridge
/// deployments. One of these per configured entry in `@vampchains/chains`'
/// `HOME_CHAINS` — see that package for why the set of home chains is a
/// hardcoded three, not a generic list.
export interface HomeChainRuntimeConfig {
  homeChainId: number;
  key: HomeChainKey;
  l1RpcUrl: string;
  bridgeAddress: Address;
  confirmations: number;
  /// This home chain's own relayer signing key — deliberately separate per
  /// chain (see .secrets/testnet-wallets.json's note on why) rather than
  /// one key shared across all three: it's the key that authorizes every
  /// withdrawal claim, already the single biggest documented risk in the
  /// system, so one compromise shouldn't drain three bridges instead of one.
  relayerPrivateKey: Hex;
}

export interface RelayerConfig {
  /// Only the home chains that actually have complete env config present —
  /// see `loadHomeChains` below. Lets a partial rollout run without a hard
  /// crash; a home chain simply doesn't get watched until its config is
  /// filled in (relevant right now specifically because Robinhood Chain
  /// Testnet's deployment is still pending a funded deployer wallet).
  homeChains: HomeChainRuntimeConfig[];
  /// Signs real transfers on each vampchain to mint deposits. Never touches
  /// any home chain, never needs L1 gas on any of them; it only ever spends
  /// a vampchain's own pre-funded native currency, on the vampchain itself
  /// — so the same key works across every vampchain regardless of which
  /// home chain spawned it. See docs/ARCHITECTURE.md "Why geth Clique PoA".
  treasuryPrivateKey: Hex;
  pollIntervalMs: number;
  burnAddress: Address;
  /// The shared Clique signer/etherbase address baked into every
  /// vampchain's genesis (`--miner.etherbase`, see
  /// infra/sidechain-node/entrypoint.sh) — public info, not a secret, same
  /// address across every vampchain regardless of home chain by design. A
  /// burn *from* this address is swept protocol fee revenue (feeSweep.ts),
  /// not a user withdrawal — see withdrawalWatcher.ts and
  /// docs/ARCHITECTURE.md "Protocol fee revenue". The relayer never holds
  /// this account's private key: sweeps go out via `eth_sendTransaction`
  /// against the vampchain's own unlocked keystore, over the chain's
  /// internal RPC.
  cliqueSignerAddress: Address;
  /// Below this native-wei balance, feeSweep.ts skips a chain rather than
  /// submitting a sweep transaction whose own gas cost would eat most or
  /// all of what it's sweeping. Default 0.01 native units (18-decimal).
  feeSweepDustThresholdWei: bigint;
  /// How often gasContributionWatcher.ts runs — used to power the "blood
  /// given" leaderboard AND (as of the TxActivity extension) scan/'s
  /// native-transaction history, so unlike a pure leaderboard, staleness
  /// here is now user-visible. Default 30s: every call is direct to a
  /// vampchain's own internal RPC (never the public rate-limited gateway),
  /// and this roughly matches the cadence the relayer already polls every
  /// active chain at for its other watchers — not a new order of magnitude
  /// of load. Still never anything that moves money, so it's fine for this
  /// to lag briefly under real load; it just doesn't need to lag a full day
  /// anymore now that something in the UI actually depends on freshness.
  gasContributionIntervalMs: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

/// Builds one `HomeChainRuntimeConfig` per home chain in `@vampchains/chains`
/// that has *all* of its env vars present — `{KEY}_L1_RPC_URL`,
/// `{KEY}_BRIDGE_ADDRESS`, `{KEY}_RELAYER_PRIVATE_KEY` (e.g.
/// `BASE_L1_RPC_URL`, `ETHEREUM_BRIDGE_ADDRESS`,
/// `ROBINHOOD_RELAYER_PRIVATE_KEY`). A home chain missing any of these is
/// skipped with a warning rather than crashing the whole process.
function loadHomeChains(): HomeChainRuntimeConfig[] {
  const configs: HomeChainRuntimeConfig[] = [];

  for (const chain of HOME_CHAINS) {
    const prefix = chain.key.toUpperCase();
    const l1RpcUrl = process.env[`${prefix}_L1_RPC_URL`];
    const bridgeAddress = process.env[`${prefix}_BRIDGE_ADDRESS`];
    const relayerPrivateKey = process.env[`${prefix}_RELAYER_PRIVATE_KEY`];

    if (!l1RpcUrl || !bridgeAddress || !relayerPrivateKey) {
      console.warn(`[config] ${chain.name} (${prefix}_*) not fully configured, skipping — not watched this run`);
      continue;
    }
    if (!isHex(relayerPrivateKey)) {
      throw new Error(`${prefix}_RELAYER_PRIVATE_KEY must be a 0x-prefixed hex string`);
    }

    configs.push({
      homeChainId: chain.id,
      key: chain.key,
      l1RpcUrl,
      bridgeAddress: getAddress(bridgeAddress),
      confirmations: Number(process.env[`${prefix}_CONFIRMATIONS`] ?? 2),
      relayerPrivateKey,
    });
  }

  if (configs.length === 0) throw new Error("no home chains configured — set at least one {KEY}_* env var group");
  return configs;
}

export function loadConfig(): RelayerConfig {
  const treasuryPrivateKey = requireEnv("TREASURY_PRIVATE_KEY");
  if (!isHex(treasuryPrivateKey)) throw new Error("TREASURY_PRIVATE_KEY must be a 0x-prefixed hex string");

  return {
    homeChains: loadHomeChains(),
    treasuryPrivateKey,
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 4000),
    // The withdrawal-signal address on every vampchain: sending native
    // currency here signals "I want to withdraw." Deliberately the same
    // treasury account minting spends from, not a real dead address — see
    // "Withdrawal signal: recapture, not destroy" in docs/ARCHITECTURE.md.
    burnAddress: getAddress(process.env.BURN_ADDRESS ?? "0x12f5B89B02C8107278c5F24E74d7B44267C55d1f"),
    cliqueSignerAddress: getAddress(requireEnv("CLIQUE_SIGNER_ADDRESS")),
    feeSweepDustThresholdWei: BigInt(process.env.FEE_SWEEP_DUST_THRESHOLD_WEI ?? "10000000000000000"),
    gasContributionIntervalMs: Number(process.env.GAS_CONTRIBUTION_INTERVAL_MS ?? 30 * 1000),
  };
}
