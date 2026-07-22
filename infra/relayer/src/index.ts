import type { PublicClient } from "viem";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prisma, type Chain as ChainRow } from "@vampchains/db";
import { loadConfig, type HomeChainRuntimeConfig, type RelayerConfig } from "./config.js";
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

/// Everything needed to watch/sign for one home chain's bridge, built once
/// at startup and reused every tick.
interface HomeChainRuntime {
  config: HomeChainRuntimeConfig;
  l1Public: PublicClient;
  /// This home chain's own relayer signing key (see config.ts for why it's
  /// deliberately separate per chain, not shared).
  signingAccount: SigningAccount;
}

function buildHomeChainRuntimes(cfg: RelayerConfig): Map<number, HomeChainRuntime> {
  const runtimes = new Map<number, HomeChainRuntime>();
  for (const home of cfg.homeChains) {
    runtimes.set(home.homeChainId, {
      config: home,
      l1Public: createPublicClient({ transport: http(home.l1RpcUrl) }),
      signingAccount: privateKeyToAccount(home.relayerPrivateKey),
    });
  }
  return runtimes;
}

async function tickDeposits(runtime: HomeChainRuntime, treasuryAccount: SigningAccount) {
  const { config, l1Public } = runtime;
  try {
    await pollDeposits(l1Public, config.homeChainId, config.bridgeAddress, config.confirmations, treasuryAccount);
  } catch (err) {
    console.error(`[deposits][${config.key}] poll failed:`, err);
  }

  try {
    await pollGeneralDeposits(l1Public, config.homeChainId, config.bridgeAddress, config.confirmations, treasuryAccount);
  } catch (err) {
    console.error(`[general-deposits][${config.key}] poll failed:`, err);
  }
}

/// Everything below operates on one *vampchain*, not one home chain
/// directly — but claim-signing still has to happen against whichever home
/// chain's bridge that specific vampchain was created from, so each pass
/// looks up the right `HomeChainRuntime` via `chain.homeChainId` first.
async function tickVampchain(chain: ChainRow, runtimes: Map<number, HomeChainRuntime>, cfg: RelayerConfig) {
  const home = runtimes.get(chain.homeChainId);
  if (!home) {
    console.warn(
      `[relayer] chain ${chain.chainId} belongs to home chain ${chain.homeChainId}, which isn't configured on this deployment — skipping`
    );
    return;
  }
  const { config, signingAccount } = home;

  try {
    await sweepTips(chain, cfg.cliqueSignerAddress, cfg.burnAddress, cfg.feeSweepDustThresholdWei);
  } catch (err) {
    console.error(`[fee-sweep] failed for chain ${chain.chainId}:`, err);
  }
  try {
    await pollWithdrawals(chain, signingAccount, config.homeChainId, config.bridgeAddress, cfg.burnAddress, cfg.cliqueSignerAddress);
  } catch (err) {
    console.error(`[withdrawals] poll failed for chain ${chain.chainId}:`, err);
  }
  try {
    await pollGeneralWithdrawals(chain, signingAccount, config.homeChainId, config.bridgeAddress, cfg.burnAddress);
  } catch (err) {
    console.error(`[general-withdrawals] poll failed for chain ${chain.chainId}:`, err);
  }
  try {
    await trackBurnedFees(chain, signingAccount, config.homeChainId, config.bridgeAddress);
  } catch (err) {
    console.error(`[base-fee] tracking failed for chain ${chain.chainId}:`, err);
  }
}

async function tick(runtimes: Map<number, HomeChainRuntime>, treasuryAccount: SigningAccount, cfg: RelayerConfig) {
  for (const runtime of runtimes.values()) {
    await tickDeposits(runtime, treasuryAccount);
  }

  let activeChains: ChainRow[];
  try {
    activeChains = await prisma.chain.findMany({ where: { status: "ACTIVE", rpcUrl: { not: null } } });
  } catch (err) {
    console.error("[relayer] failed to load active chains:", err);
    return;
  }

  for (const chain of activeChains) {
    await tickVampchain(chain, runtimes, cfg);
  }
}

async function main() {
  const cfg = loadConfig();
  const runtimes = buildHomeChainRuntimes(cfg);
  // Submits real transactions, but only ever on a vampchain, spending that
  // chain's own pre-funded native currency — never L1 gas, on any home
  // chain. This relayer process has no L1 gas dependency at all.
  const treasuryAccount = privateKeyToAccount(cfg.treasuryPrivateKey);

  console.log(
    `vampchains relayer starting: treasury=${treasuryAccount.address} pollMs=${cfg.pollIntervalMs} homeChains=[${Array.from(
      runtimes.values()
    )
      .map((r) => `${r.config.key}(signer=${r.signingAccount.address},bridge=${r.config.bridgeAddress})`)
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
    await tick(runtimes, treasuryAccount, cfg);
    await sleep(cfg.pollIntervalMs);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("relayer crashed:", err);
  process.exit(1);
});
