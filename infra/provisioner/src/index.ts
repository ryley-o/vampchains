import type { PublicClient } from "viem";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prisma } from "@vampchains/db";
import { loadConfig, type HomeChainRuntimeConfig, type ProvisionerConfig } from "./config.js";
import { pollNewChains } from "./chainWatcher.js";
import {
  buildAndPublishSnapshots,
  detectGraceExpiredChains,
  provisionPendingChains,
  sweepExpiredSnapshots,
  teardownDeactivatingChains,
} from "./lifecycleWorker.js";
import { makeL1WalletClient, type L1WalletClient } from "./l1Client.js";
import type { Provisioner } from "./provisioners/types.js";
import { LocalDockerProvisioner } from "./provisioners/localDocker.js";
import { FlyProvisioner } from "./provisioners/fly.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildProvisioner(cfg: ProvisionerConfig): Provisioner {
  if (cfg.backend === "local-docker") {
    return new LocalDockerProvisioner({
      image: cfg.sidechainImage,
      network: cfg.dockerNetwork,
      hostPortBase: cfg.localHostPortBase,
      cliqueSignerPrivateKey: cfg.cliqueSignerPrivateKey,
    });
  }

  if (!cfg.flyApiToken || !cfg.flyOrgSlug) {
    throw new Error("FLY_API_TOKEN and FLY_ORG_SLUG are required when PROVISION_BACKEND=fly");
  }
  return new FlyProvisioner({
    apiToken: cfg.flyApiToken,
    orgSlug: cfg.flyOrgSlug,
    image: cfg.sidechainImage,
    region: cfg.flyRegion,
    cliqueSignerPrivateKey: cfg.cliqueSignerPrivateKey,
  });
}

/// Everything needed to watch/administer one home chain, built once at
/// startup and reused every tick — a fresh L1 client per chain (each has
/// its own RPC), its own gas-paying wallet (the *same* provisionerPrivateKey
/// reused across all three — an EOA's address is identical on every EVM
/// chain regardless, so one funded wallet per chain is enough, no separate
/// keys needed here), and its own relayer signing account (deliberately
/// separate per chain — see config.ts).
interface HomeChainRuntime {
  config: HomeChainRuntimeConfig;
  l1Public: PublicClient;
  l1Wallet: L1WalletClient;
  relayerSigningAccount: ReturnType<typeof privateKeyToAccount>;
}

function buildHomeChainRuntimes(cfg: ProvisionerConfig): HomeChainRuntime[] {
  const provisionerAccount = privateKeyToAccount(cfg.provisionerPrivateKey);
  return cfg.homeChains.map((home) => ({
    config: home,
    l1Public: createPublicClient({ transport: http(home.l1RpcUrl) }),
    l1Wallet: makeL1WalletClient(provisionerAccount, home.homeChainId, home.l1RpcUrl),
    // Pure signing key, same role as `infra/relayer`'s use of the matching
    // key — never submits a transaction, never needs L1 gas. Only ever
    // used to sign the `Snapshot(chainId, root)` attestation
    // `publishSnapshot` checks; the actual L1 transaction is submitted
    // (and paid for) by `provisionerAccount` above.
    relayerSigningAccount: privateKeyToAccount(home.relayerPrivateKey),
  }));
}

async function tickHomeChain(runtime: HomeChainRuntime, cfg: ProvisionerConfig) {
  const { config, l1Public, l1Wallet, relayerSigningAccount } = runtime;

  try {
    await pollNewChains(l1Public, config.homeChainId, config.registryAddress, config.confirmations);
  } catch (err) {
    console.error(`[chains][${config.key}] poll failed:`, err);
  }

  try {
    await detectGraceExpiredChains(l1Public, l1Wallet, config.homeChainId, config.registryAddress);
  } catch (err) {
    console.error(`[lifecycle][${config.key}] grace-expiry check failed:`, err);
  }

  try {
    await buildAndPublishSnapshots(
      l1Public,
      l1Wallet,
      relayerSigningAccount,
      config.homeChainId,
      config.bridgeAddress,
      cfg.treasuryAddress,
      cfg.cliqueSignerAddress
    );
  } catch (err) {
    console.error(`[lifecycle][${config.key}] snapshot build/publish pass failed:`, err);
  }

  try {
    await sweepExpiredSnapshots(l1Public, l1Wallet, config.homeChainId, config.bridgeAddress);
  } catch (err) {
    console.error(`[lifecycle][${config.key}] unclaimed-sweep pass failed:`, err);
  }
}

async function tick(runtimes: HomeChainRuntime[], cfg: ProvisionerConfig, provisioner: Provisioner) {
  // Home-chain-agnostic passes — a vampchain's own infra doesn't care which
  // home chain spawned it — run once per tick, not once per home chain.
  try {
    await provisionPendingChains(provisioner);
  } catch (err) {
    console.error("[lifecycle] provisioning pass failed:", err);
  }

  for (const runtime of runtimes) {
    await tickHomeChain(runtime, cfg);
  }

  try {
    await teardownDeactivatingChains(provisioner);
  } catch (err) {
    console.error("[lifecycle] teardown pass failed:", err);
  }
}

async function main() {
  const cfg = loadConfig();
  const runtimes = buildHomeChainRuntimes(cfg);
  const provisioner = buildProvisioner(cfg);

  console.log(
    `vampchains provisioner starting: backend=${cfg.backend} pollMs=${cfg.pollIntervalMs} homeChains=[${runtimes
      .map((r) => `${r.config.key}(registry=${r.config.registryAddress})`)
      .join(", ")}]`
  );

  let running = true;
  const shutdown = () => {
    console.log("shutting down...");
    running = false;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (running) {
    await tick(runtimes, cfg, provisioner);
    await sleep(cfg.pollIntervalMs);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("provisioner crashed:", err);
  process.exit(1);
});
