import { type Address, type Hex, getAddress, isHex } from "viem";

export type Backend = "local-docker" | "fly";

export interface ProvisionerConfig {
  l1RpcUrl: string;
  l1ChainId: number;
  registryAddress: Address;
  provisionerPrivateKey: Hex;
  pollIntervalMs: number;
  confirmations: number;
  backend: Backend;

  /// The Clique block-signing key baked into every vampchain node this
  /// provisioner creates — same key reused across every chain by design,
  /// see docs/ARCHITECTURE.md.
  cliqueSignerPrivateKey: string;

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

  return {
    l1RpcUrl: requireEnv("L1_RPC_URL"),
    l1ChainId: Number(requireEnv("L1_CHAIN_ID")),
    registryAddress: getAddress(requireEnv("REGISTRY_ADDRESS")),
    provisionerPrivateKey,
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 6000),
    confirmations: Number(process.env.CONFIRMATIONS ?? 2),
    backend,
    cliqueSignerPrivateKey: requireEnv("CLIQUE_SIGNER_PRIVATE_KEY"),
    sidechainImage: process.env.SIDECHAIN_IMAGE ?? "vampchains-sidechain-node:latest",
    dockerNetwork: process.env.DOCKER_NETWORK,
    localHostPortBase: Number(process.env.LOCAL_HOST_PORT_BASE ?? 8600),
    flyApiToken: process.env.FLY_API_TOKEN,
    flyOrgSlug: process.env.FLY_ORG_SLUG,
    flyRegion: process.env.FLY_REGION ?? "iad",
  };
}
