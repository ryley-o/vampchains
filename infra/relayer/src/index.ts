import type { PublicClient } from "viem";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prisma } from "@vampchains/db";
import { loadConfig, type RelayerConfig } from "./config.js";
import { pollDeposits } from "./depositWatcher.js";
import { pollWithdrawals } from "./withdrawalWatcher.js";
import { makeL1WalletClient, type L1WalletClient } from "./l1WalletClient.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tick(l1Public: PublicClient, l1Wallet: L1WalletClient, cfg: RelayerConfig) {
  try {
    await pollDeposits(l1Public, cfg.bridgeAddress, cfg.confirmations);
  } catch (err) {
    console.error("[deposits] poll failed:", err);
  }

  let activeChains;
  try {
    activeChains = await prisma.chain.findMany({ where: { status: "ACTIVE", rpcUrl: { not: null } } });
  } catch (err) {
    console.error("[withdrawals] failed to load active chains:", err);
    return;
  }

  for (const chain of activeChains) {
    try {
      await pollWithdrawals(chain, l1Wallet, cfg.bridgeAddress, cfg.burnAddress);
    } catch (err) {
      console.error(`[withdrawals] poll failed for chain ${chain.chainId}:`, err);
    }
  }
}

async function main() {
  const cfg = loadConfig();
  const account = privateKeyToAccount(cfg.relayerPrivateKey);
  const l1Public: PublicClient = createPublicClient({ transport: http(cfg.l1RpcUrl) });
  const l1Wallet = makeL1WalletClient(account, cfg.l1ChainId, cfg.l1RpcUrl);

  console.log(
    `vampchains relayer starting: relayer=${account.address} bridge=${cfg.bridgeAddress} l1=${cfg.l1RpcUrl} pollMs=${cfg.pollIntervalMs}`
  );

  let running = true;
  const shutdown = () => {
    console.log("shutting down...");
    running = false;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (running) {
    await tick(l1Public, l1Wallet, cfg);
    await sleep(cfg.pollIntervalMs);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("relayer crashed:", err);
  process.exit(1);
});
