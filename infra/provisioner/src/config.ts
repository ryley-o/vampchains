import { type Address, type Hex, getAddress, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { HOME_CHAINS, type HomeChainKey } from "@vampchains/chains";

export type Backend = "local-docker" | "fly";

/// Per-home-chain runtime config — everything the provisioner needs to
/// watch and administer *one* of the three home chains' VampChainRegistry/
/// VampBridge deployments. One of these per configured entry in
/// `@vampchains/chains`' `HOME_CHAINS` — see that package for why the set
/// of home chains is a hardcoded three, not a generic list.
export interface HomeChainRuntimeConfig {
  homeChainId: number;
  key: HomeChainKey;
  l1RpcUrl: string;
  registryAddress: Address;
  bridgeAddress: Address;
  confirmations: number;
  /// This home chain's own relayer signing key — deliberately separate per
  /// chain (see .secrets/testnet-wallets.json's note on why) rather than
  /// one key shared across all three. Used here purely to sign the
  /// `Snapshot(chainId, root)` EIP-712 attestation `publishSnapshot`
  /// checks — never to submit a transaction or move funds.
  relayerPrivateKey: Hex;
}

export interface ProvisionerConfig {
  /// Only the home chains that actually have complete env config present —
  /// see `loadHomeChains` below. Lets a partial rollout (e.g. Base +
  /// Ethereum configured, Robinhood still pending funding) run without a
  /// hard crash; a home chain simply doesn't get watched until its config
  /// is filled in.
  homeChains: HomeChainRuntimeConfig[];
  provisionerPrivateKey: Hex;
  pollIntervalMs: number;
  backend: Backend;

  /// The Clique block-signing key baked into every vampchain node this
  /// provisioner creates — same key reused across every chain (regardless
  /// of home chain) by design, see docs/ARCHITECTURE.md.
  cliqueSignerPrivateKey: string;
  /// The public address matching `cliqueSignerPrivateKey` — used to
  /// exclude that account's balance from a chain's final snapshot (it's
  /// accumulated protocol tip revenue, not a user claim; see
  /// snapshotBuilder.ts here and docs/ARCHITECTURE.md "Protocol fee
  /// revenue").
  cliqueSignerAddress: Address;
  /// Native currency treasury/burn-signal address on every vampchain —
  /// excluded from snapshots for the same reason as `cliqueSignerAddress`:
  /// its balance is working capital, not a user claim (see
  /// docs/ARCHITECTURE.md "Why geth Clique PoA"). Same address across
  /// every vampchain regardless of home chain, same as `cliqueSignerAddress`.
  treasuryAddress: Address;

  // local-docker backend
  sidechainImage: string;
  dockerNetwork?: string;
  localHostPortBase: number;

  // fly backend
  flyApiToken?: string;
  flyOrgSlug?: string;
  flyRegion: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

/// Builds one `HomeChainRuntimeConfig` per home chain in `@vampchains/chains`
/// that has *all* of its env vars present — `{KEY}_L1_RPC_URL`,
/// `{KEY}_REGISTRY_ADDRESS`, `{KEY}_BRIDGE_ADDRESS`, `{KEY}_RELAYER_PRIVATE_KEY`
/// (e.g. `BASE_L1_RPC_URL`, `ETHEREUM_REGISTRY_ADDRESS`,
/// `ROBINHOOD_RELAYER_PRIVATE_KEY`). A home chain missing any of these is
/// skipped with a warning rather than crashing the whole process — lets
/// chains come online one at a time as they're actually deployed/funded,
/// which matters right now specifically because Robinhood Chain Testnet's
/// deployment is still pending a funded deployer wallet.
function loadHomeChains(): HomeChainRuntimeConfig[] {
  const configs: HomeChainRuntimeConfig[] = [];

  for (const chain of HOME_CHAINS) {
    const prefix = chain.key.toUpperCase();
    const l1RpcUrl = process.env[`${prefix}_L1_RPC_URL`];
    const registryAddress = process.env[`${prefix}_REGISTRY_ADDRESS`];
    const bridgeAddress = process.env[`${prefix}_BRIDGE_ADDRESS`];
    const relayerPrivateKey = process.env[`${prefix}_RELAYER_PRIVATE_KEY`];

    if (!l1RpcUrl || !registryAddress || !bridgeAddress || !relayerPrivateKey) {
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
      registryAddress: getAddress(registryAddress),
      bridgeAddress: getAddress(bridgeAddress),
      confirmations: Number(process.env[`${prefix}_CONFIRMATIONS`] ?? 2),
      relayerPrivateKey,
    });
  }

  if (configs.length === 0) throw new Error("no home chains configured — set at least one {KEY}_* env var group");
  return configs;
}

export function loadConfig(): ProvisionerConfig {
  const provisionerPrivateKey = requireEnv("PROVISIONER_PRIVATE_KEY");
  if (!isHex(provisionerPrivateKey)) throw new Error("PROVISIONER_PRIVATE_KEY must be a 0x-prefixed hex string");

  const backend = (process.env.PROVISION_BACKEND ?? "local-docker") as Backend;
  if (backend !== "local-docker" && backend !== "fly") {
    throw new Error(`PROVISION_BACKEND must be "local-docker" or "fly", got "${backend}"`);
  }

  const cliqueSignerPrivateKey = requireEnv("CLIQUE_SIGNER_PRIVATE_KEY");
  if (!isHex(cliqueSignerPrivateKey)) throw new Error("CLIQUE_SIGNER_PRIVATE_KEY must be a 0x-prefixed hex string");

  return {
    homeChains: loadHomeChains(),
    provisionerPrivateKey,
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 6000),
    backend,
    cliqueSignerPrivateKey,
    cliqueSignerAddress: privateKeyToAccount(cliqueSignerPrivateKey).address,
    treasuryAddress: getAddress(process.env.TREASURY_ADDRESS ?? "0x12f5B89B02C8107278c5F24E74d7B44267C55d1f"),
    sidechainImage: process.env.SIDECHAIN_IMAGE ?? "vampchains-sidechain-node:latest",
    dockerNetwork: process.env.DOCKER_NETWORK,
    localHostPortBase: Number(process.env.LOCAL_HOST_PORT_BASE ?? 8600),
    flyApiToken: process.env.FLY_API_TOKEN,
    flyOrgSlug: process.env.FLY_ORG_SLUG,
    flyRegion: process.env.FLY_REGION ?? "iad",
  };
}
