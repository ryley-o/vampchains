import type { PublicClient } from "viem";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prisma } from "@vampchains/db";
import { loadConfig, type RelayerConfig } from "./config.js";
import { pollDeposits } from "./depositWatcher.js";
import { pollWithdrawals } from "./withdrawalWatcher.js";
import { pollGeneralDeposits } from "./generalDepositWatcher.js";
import { pollGeneralWithdrawals } from "./generalWithdrawalWatcher.js";
import { trackBurnedFees } from "./baseFeeWatcher.js";
import { sweepTips } from "./feeSweep.js";

type SigningAccount = ReturnType<typeof privateKeyToAccount>;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tick(
  l1Public: PublicClient,
  signingAccount: SigningAccount,
  treasuryAccount: SigningAccount,
  cfg: RelayerConfig
) {
  try {
    await pollDeposits(l1Public, cfg.bridgeAddress, cfg.confirmations, treasuryAccount);
  } catch (err) {
    console.error("[deposits] poll failed:", err);
  }

  try {
    await pollGeneralDeposits(l1Public, cfg.bridgeAddress, cfg.confirmations, treasuryAccount);
  } catch (err) {
    console.error("[general-deposits] poll failed:", err);
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
      await sweepTips(chain, cfg.cliqueSignerAddress, cfg.burnAddress, cfg.feeSweepDustThresholdWei);
    } catch (err) {
      console.error(`[fee-sweep] failed for chain ${chain.chainId}:`, err);
    }
    try {
      await pollWithdrawals(
        chain,
        signingAccount,
        cfg.l1ChainId,
        cfg.bridgeAddress,
        cfg.burnAddress,
        cfg.cliqueSignerAddress
      );
    } catch (err) {
      console.error(`[withdrawals] poll failed for chain ${chain.chainId}:`, err);
    }
    try {
      await pollGeneralWithdrawals(chain, signingAccount, cfg.l1ChainId, cfg.bridgeAddress, cfg.burnAddress);
    } catch (err) {
      console.error(`[general-withdrawals] poll failed for chain ${chain.chainId}:`, err);
    }
    try {
      await trackBurnedFees(chain, signingAccount, cfg.l1ChainId, cfg.bridgeAddress);
    } catch (err) {
      console.error(`[base-fee] tracking failed for chain ${chain.chainId}:`, err);
    }
  }
}

async function main() {
  const cfg = loadConfig();
  // `account` is a pure EIP-712 signing key: never submits a transaction,
  // never needs L1 ETH — it only ever signs withdrawal claims (see
  // eip712.ts). `treasuryAccount` DOES submit real transactions, but only
  // ever on a vampchain, spending that chain's own pre-funded native
  // currency — never L1 gas either. This relayer process has no L1 gas
  // dependency at all.
  const account = privateKeyToAccount(cfg.relayerPrivateKey);
  const treasuryAccount = privateKeyToAccount(cfg.treasuryPrivateKey);
  const l1Public: PublicClient = createPublicClient({ transport: http(cfg.l1RpcUrl) });

  console.log(
    `vampchains relayer starting: signer=${account.address} treasury=${treasuryAccount.address} bridge=${cfg.bridgeAddress} l1=${cfg.l1RpcUrl} pollMs=${cfg.pollIntervalMs}`
  );

  let running = true;
  const shutdown = () => {
    console.log("shutting down...");
    running = false;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (running) {
    await tick(l1Public, account, treasuryAccount, cfg);
    await sleep(cfg.pollIntervalMs);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("relayer crashed:", err);
  process.exit(1);
});
