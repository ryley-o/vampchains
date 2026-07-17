import type { PublicClient } from "viem";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prisma } from "@vampchains/db";
import { loadConfig, type RelayerConfig } from "./config.js";
import { pollDeposits } from "./depositWatcher.js";
import { pollWithdrawals } from "./withdrawalWatcher.js";

type SigningAccount = ReturnType<typeof privateKeyToAccount>;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tick(l1Public: PublicClient, signingAccount: SigningAccount, cfg: RelayerConfig) {
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
      await pollWithdrawals(chain, signingAccount, cfg.l1ChainId, cfg.bridgeAddress, cfg.burnAddress);
    } catch (err) {
      console.error(`[withdrawals] poll failed for chain ${chain.chainId}:`, err);
    }
  }
}

async function main() {
  const cfg = loadConfig();
  // Pure local signing account — never submits a transaction, never needs
  // ETH. Deposits are minted via anvil_setBalance (free), and withdrawals
  // are now claim signatures (also free) rather than pushed release() txs.
  // This relayer process has no L1 gas dependency at all.
  const account = privateKeyToAccount(cfg.relayerPrivateKey);
  const l1Public: PublicClient = createPublicClient({ transport: http(cfg.l1RpcUrl) });

  console.log(
    `vampchains relayer starting: signer=${account.address} bridge=${cfg.bridgeAddress} l1=${cfg.l1RpcUrl} pollMs=${cfg.pollIntervalMs}`
  );

  let running = true;
  const shutdown = () => {
    console.log("shutting down...");
    running = false;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (running) {
    await tick(l1Public, account, cfg);
    await sleep(cfg.pollIntervalMs);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("relayer crashed:", err);
  process.exit(1);
});
