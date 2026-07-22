import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@vampchains/db";
import { getOnchainChain, getRemainingRuntime } from "@/lib/registryReads";
import { getBurnedFeesClaimed } from "@/lib/bridgeReads";
import { formatTokenAmount, formatUsdc, shortAddress } from "@/lib/format";
import { GATEWAY_URL, CONTRACTS_CONFIGURED, L1_CHAIN_ID } from "@/lib/contracts";
import { StatusPill } from "@/components/StatusPill";
import { TokenLogo } from "@/components/TokenLogo";
import { BridgeForm } from "@/components/BridgeForm";
import { GeneralBridgeForm } from "@/components/GeneralBridgeForm";
import { TopUpForm } from "@/components/TopUpForm";
import { ExplorerPanel } from "@/components/ExplorerPanel";
import { AutoRefresh } from "@/components/AutoRefresh";
import { AddToWalletButton } from "@/components/AddToWalletButton";
import { RunwayMeter } from "@/components/brand/RunwayMeter";

export const dynamic = "force-dynamic";

/// Copy for every non-active status a chain can be in — deliberately
/// distinct per status rather than one generic "not active" bucket, since
/// each one means something different to someone looking at this page.
const STATUS_COPY: Record<string, { tone: string; title: string; body: React.ReactNode }> = {
  PENDING_PROVISION: {
    tone: "border-amber-800/60 bg-amber-950/20 text-amber-300",
    title: "Spinning up",
    body: "Seen on-chain, infrastructure hasn't started yet — this usually takes a few seconds.",
  },
  PROVISIONING: {
    tone: "border-amber-800/60 bg-amber-950/20 text-amber-300",
    title: "Almost there",
    body: "Your sidechain is being provisioned right now. This page will update automatically once it's live.",
  },
  PROVISION_FAILED: {
    tone: "border-blood/60 bg-blood/10 text-blood-bright",
    title: "Provisioning failed",
    body: "Something went wrong standing up this chain's infrastructure. This needs a human to look at it — reach out if this is your chain.",
  },
  AWAITING_SNAPSHOT: {
    tone: "border-blood/60 bg-blood/10 text-blood-bright",
    title: "Finalizing final snapshot",
    body: "This chain's grace period just expired. We're reading its last real balances and publishing a snapshot right now — check back shortly, then look up your wallet on the claim page.",
  },
  DEACTIVATING: {
    tone: "border-hairline-strong bg-charcoal-soft/40 text-bone-dim",
    title: "Snapshot published, infra winding down",
    body: (
      <>
        The final snapshot is already published — you can claim now if you had funds here.
        Infrastructure teardown is still finishing up in the background.
      </>
    ),
  },
  DEACTIVATED: {
    tone: "border-hairline-strong bg-charcoal-soft/40 text-bone-dim",
    title: "Torn down",
    body: "This chain's grace period expired and a final snapshot of every balance it had was taken. Its infrastructure is gone for good.",
  },
};

function Panel({ title, eyebrow, children }: { title: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-hairline bg-ink-raised p-6 sm:p-8">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-blood">{eyebrow}</p>
      <h2 className="text-display mt-1.5 text-2xl text-bone">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default async function ChainDetailPage({ params }: { params: Promise<{ chainId: string }> }) {
  const { chainId: chainIdParam } = await params;

  let chainId: bigint;
  try {
    chainId = BigInt(chainIdParam);
  } catch {
    notFound();
  }

  const dbChain = await prisma.chain.findUnique({ where: { chainId } });
  if (!dbChain) notFound();

  const [onchain, remainingRuntime, wrappedTokenRows, burnedFeesClaimed] = await Promise.all([
    getOnchainChain(chainId),
    getRemainingRuntime(chainId),
    prisma.wrappedToken.findMany({ where: { chainDbId: dbChain.id }, orderBy: { createdAt: "asc" } }),
    getBurnedFeesClaimed(chainId),
  ]);

  const wrappedTokens = wrappedTokenRows.map((w) => ({
    l1Token: w.l1Token as `0x${string}`,
    wrapped: w.wrapped as `0x${string}`,
    name: w.name,
    symbol: w.symbol,
    decimals: w.decimals,
  }));

  const gatewayRpcUrl = `${GATEWAY_URL}/rpc/${chainId}`;
  const isActive = dbChain.status === "ACTIVE" && !!dbChain.rpcUrl;
  // remainingRuntime hits 0 the instant paid-up funding depletes, but
  // isActive() stays true throughout the week-long grace period that
  // follows (see VampChainRegistry.sol) — this chain is still fully
  // usable, just running on borrowed time until someone tops it up.
  const inGracePeriod = isActive && onchain !== null && remainingRuntime === 0n;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-5 py-14 sm:py-16">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <TokenLogo address={dbChain.baseToken} chainId={L1_CHAIN_ID} size={48} className="mt-1" />
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-blood">
              Vampchain #{dbChain.evmChainId.toString()}
            </p>
            <h1 className="text-display mt-1.5 text-4xl text-bone sm:text-5xl">{dbChain.name}</h1>
            <p className="mt-3 text-sm text-bone-dim/60">
              <span className="font-mono text-bone-dim">${dbChain.symbol}</span> · base token{" "}
              <span className="font-mono">{shortAddress(dbChain.baseToken)}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusPill status={dbChain.status} />
          {isActive && (
            <AddToWalletButton
              evmChainId={dbChain.evmChainId}
              name={dbChain.name}
              symbol={dbChain.symbol}
              rpcUrl={gatewayRpcUrl}
            />
          )}
        </div>
      </div>

      <Panel title="Funding" eyebrow="Runway">
        {!CONTRACTS_CONFIGURED || !onchain ? (
          <p className="text-sm text-bone-dim/50">Live funding data unavailable right now.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-6 text-sm sm:grid-cols-4">
              <div>
                <p className="text-bone-dim/50">Balance</p>
                <p className="mt-1 font-mono text-lg text-bone">${formatUsdc(onchain.fundingBalance)}</p>
              </div>
              <div>
                <p className="text-bone-dim/50">Annual fee</p>
                <p className="mt-1 font-mono text-lg text-bone">${formatUsdc(onchain.annualFeeUSDC)}</p>
              </div>
              <div className="col-span-2 sm:col-span-2">
                <p className="text-bone-dim/50">Vital signs</p>
                <div className="mt-2">
                  <RunwayMeter remainingRuntime={remainingRuntime} active={dbChain.status === "ACTIVE"} />
                </div>
              </div>
            </div>
            <div className="mt-6 border-t border-hairline pt-6">
              <TopUpForm chainId={chainId} />
            </div>
          </>
        )}
      </Panel>

      {CONTRACTS_CONFIGURED && onchain && (
        <Panel title="Creator earnings" eyebrow="50/50 split">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm text-bone-dim/60">
                Gas fees this chain generates split 50/50 between its creator{" "}
                <span className="font-mono text-bone-dim">{shortAddress(onchain.creator)}</span>{" "}
                and the protocol — automatically, for as long as it&apos;s running.
              </p>
              <p className="mt-1 text-xs text-bone-dim/40">
                Base-fee revenue recaptured so far (floor — swept tip revenue adds to this too).
              </p>
            </div>
            <p className="font-mono text-2xl text-emerald-300">
              {formatTokenAmount(burnedFeesClaimed, dbChain.baseTokenDecimals)}{" "}
              <span className="text-sm text-bone-dim/50">${dbChain.symbol}</span>
            </p>
          </div>
        </Panel>
      )}

      {inGracePeriod && (
        <p className="rounded-xl border border-blood/60 bg-blood/10 px-4 py-3 text-xs font-semibold leading-relaxed text-blood-bright">
          This chain has run out of paid funding and is in its one-week grace period — it&apos;s
          still fully open, but will be torn down for good if nobody tops it up in time.{" "}
          <span className="font-normal">Top up above to keep it alive.</span>
        </p>
      )}

      {isActive && (
        <p className="rounded-xl border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-xs leading-relaxed text-amber-300">
          Bridging is experimental. This chain, the bridge, or the business itself could be frozen
          or shut down at any time — we&apos;ll make a best effort to publish a withdrawal window
          first, but it isn&apos;t guaranteed, and funds sitting in protocols on this sidechain are
          at extra risk. Read the{" "}
          <Link href="/terms" className="underline underline-offset-2 hover:text-amber-200">
            terms
          </Link>{" "}
          before bridging anything you can&apos;t afford to lose forever.
        </p>
      )}

      {isActive && (
        <Panel title="Bridge" eyebrow="In / out">
          <BridgeForm
            chainId={chainId}
            baseToken={dbChain.baseToken as `0x${string}`}
            baseTokenSymbol={dbChain.baseTokenSymbol}
            baseTokenDecimals={dbChain.baseTokenDecimals}
            evmChainId={dbChain.evmChainId}
            gatewayRpcUrl={gatewayRpcUrl}
          />
        </Panel>
      )}

      {isActive && (
        <Panel title="Bridge other tokens" eyebrow="General bridging">
          <GeneralBridgeForm
            chainId={chainId}
            baseTokenSymbol={dbChain.baseTokenSymbol}
            evmChainId={dbChain.evmChainId}
            gatewayRpcUrl={gatewayRpcUrl}
            wrappedTokens={wrappedTokens}
          />
        </Panel>
      )}

      {isActive && (
        <Panel title="Explorer" eyebrow="Live activity">
          <p className="-mt-2 mb-5 truncate font-mono text-xs text-bone-dim/40">RPC: {gatewayRpcUrl}</p>
          <ExplorerPanel rpcUrl={gatewayRpcUrl} symbol={dbChain.baseTokenSymbol} />
        </Panel>
      )}

      {!isActive &&
        (() => {
          const copy = STATUS_COPY[dbChain.status];
          if (!copy) return null;
          // Not AWAITING_SNAPSHOT — the snapshot hasn't actually been
          // published yet at that point, so there'd be nothing to find.
          const showClaimLink = ["DEACTIVATING", "DEACTIVATED"].includes(dbChain.status);
          const isTransient = ["PENDING_PROVISION", "PROVISIONING"].includes(dbChain.status);
          return (
            <div className={`rounded-2xl border px-6 py-10 text-center text-sm ${copy.tone}`}>
              {isTransient && <AutoRefresh />}
              <p className="text-display text-lg">{copy.title}</p>
              <p className="mx-auto mt-2 max-w-md leading-relaxed opacity-90">{copy.body}</p>
              {showClaimLink && (
                <Link
                  href="/claim"
                  className="mt-4 inline-block underline underline-offset-2 hover:opacity-80"
                >
                  Look up your wallet →
                </Link>
              )}
            </div>
          );
        })()}
    </div>
  );
}
