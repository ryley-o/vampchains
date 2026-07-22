import { type Address, type Hex, getAddress, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type Backend = "local-docker" | "fly";

export interface ProvisionerConfig {
  l1RpcUrl: string;
  l1ChainId: number;
  registryAddress: Address;
  bridgeAddress: Address;
  provisionerPrivateKey: Hex;
  pollIntervalMs: number;
  confirmations: number;
  backend: Backend;

  /// The Clique block-signing key baked into every vampchain node this
  /// provisioner creates — same key reused across every chain by design,
  /// see docs/ARCHITECTURE.md.
  cliqueSignerPrivateKey: string;
  /// The public address matching `cliqueSignerPrivateKey` — used to
  /// exclude that account's balance from a chain's final snapshot (it's
  /// swept protocol fee revenue, not a user claim; see feeSweep.ts on the
  /// relayer and snapshotBuilder.ts here).
  cliqueSignerAddress: Address;
  /// Same key `infra/relayer` uses to sign withdrawal claims — shared with
  /// the provisioner *purely* to sign the EIP-712 `Snapshot(chainId, root)`
  /// attestation `VampBridge.publishSnapshot` checks. This is a deliberate,
  /// modest expansion of an already-accepted trust boundary (this project's
  /// single-signer bridge model, see docs/ARCHITECTURE.md "Known
  /// limitations") rather than a new one: the provisioner never uses this
  /// key to move funds or submit any transaction with it — only to sign,
  /// exactly like the relayer's own use of it. Submitting the actual
  /// `publishSnapshot`/`sweepUnclaimed` L1 transactions is paid for by
  /// `provisionerPrivateKey` instead, same wallet that already pays for
  /// `deactivateIfGraceExpired`.
  relayerPrivateKey: Hex;
  /// Native currency treasury/burn-signal address on every vampchain —
  /// excluded from snapshots for the same reason as `cliqueSignerAddress`:
  /// its balance is working capital, not a user claim (see
  /// docs/ARCHITECTURE.md "Why geth Clique PoA").
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

export function loadConfig(): ProvisionerConfig {
  const provisionerPrivateKey = requireEnv("PROVISIONER_PRIVATE_KEY");
  if (!isHex(provisionerPrivateKey)) throw new Error("PROVISIONER_PRIVATE_KEY must be a 0x-prefixed hex string");

  const backend = (process.env.PROVISION_BACKEND ?? "local-docker") as Backend;
  if (backend !== "local-docker" && backend !== "fly") {
    throw new Error(`PROVISION_BACKEND must be "local-docker" or "fly", got "${backend}"`);
  }

  const cliqueSignerPrivateKey = requireEnv("CLIQUE_SIGNER_PRIVATE_KEY");
  if (!isHex(cliqueSignerPrivateKey)) throw new Error("CLIQUE_SIGNER_PRIVATE_KEY must be a 0x-prefixed hex string");

  const relayerPrivateKey = requireEnv("RELAYER_PRIVATE_KEY");
  if (!isHex(relayerPrivateKey)) throw new Error("RELAYER_PRIVATE_KEY must be a 0x-prefixed hex string");

  return {
    l1RpcUrl: requireEnv("L1_RPC_URL"),
    l1ChainId: Number(requireEnv("L1_CHAIN_ID")),
    registryAddress: getAddress(requireEnv("REGISTRY_ADDRESS")),
    bridgeAddress: getAddress(requireEnv("BRIDGE_ADDRESS")),
    provisionerPrivateKey,
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 6000),
    confirmations: Number(process.env.CONFIRMATIONS ?? 2),
    backend,
    cliqueSignerPrivateKey,
    cliqueSignerAddress: privateKeyToAccount(cliqueSignerPrivateKey).address,
    relayerPrivateKey,
    treasuryAddress: getAddress(process.env.TREASURY_ADDRESS ?? "0x12f5B89B02C8107278c5F24E74d7B44267C55d1f"),
    sidechainImage: process.env.SIDECHAIN_IMAGE ?? "vampchains-sidechain-node:latest",
    dockerNetwork: process.env.DOCKER_NETWORK,
    localHostPortBase: Number(process.env.LOCAL_HOST_PORT_BASE ?? 8600),
    flyApiToken: process.env.FLY_API_TOKEN,
    flyOrgSlug: process.env.FLY_ORG_SLUG,
    flyRegion: process.env.FLY_REGION ?? "iad",
  };
}
