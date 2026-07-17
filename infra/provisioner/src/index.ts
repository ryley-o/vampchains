import type { PublicClient } from "viem";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prisma } from "@vampchains/db";
import { loadConfig, type ProvisionerConfig } from "./config.js";
import { pollNewChains } from "./chainWatcher.js";
import { detectDepletedChains, provisionPendingChains, teardownDeactivatingChains } from "./lifecycleWorker.js";
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
  });
}

async function tick(l1Public: PublicClient, l1Wallet: L1WalletClient, cfg: ProvisionerConfig, provisioner: Provisioner) {
  try {
    await pollNewChains(l1Public, cfg.registryAddress, cfg.confirmations);
  } catch (err) {
    console.error("[chains] poll failed:", err);
  }

  try {
    await provisionPendingChains(provisioner);
  } catch (err) {
    console.error("[lifecycle] provisioning pass failed:", err);
  }

  try {
    await detectDepletedChains(l1Public, l1Wallet, cfg.registryAddress);
  } catch (err) {
    console.error("[lifecycle] depletion check failed:", err);
  }

  try {
    await teardownDeactivatingChains(provisioner);
  } catch (err) {
    console.error("[lifecycle] teardown pass failed:", err);
  }
}

async function main() {
  const cfg = loadConfig();
  const account = privateKeyToAccount(cfg.provisionerPrivateKey);
  const l1Public: PublicClient = createPublicClient({ transport: http(cfg.l1RpcUrl) });
  const l1Wallet = makeL1WalletClient(account, cfg.l1ChainId, cfg.l1RpcUrl);
  const provisioner = buildProvisioner(cfg);

  console.log(
    `vampchains provisioner starting: backend=${cfg.backend} registry=${cfg.registryAddress} l1=${cfg.l1RpcUrl} pollMs=${cfg.pollIntervalMs}`
  );

  let running = true;
  const shutdown = () => {
    console.log("shutting down...");
    running = false;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (running) {
    await tick(l1Public, l1Wallet, cfg, provisioner);
    await sleep(cfg.pollIntervalMs);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("provisioner crashed:", err);
  process.exit(1);
});
