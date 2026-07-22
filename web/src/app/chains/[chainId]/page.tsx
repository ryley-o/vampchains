import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@vampchains/db";
import { getOnchainChain, getRemainingRuntime } from "@/lib/registryReads";
import { formatUsdc, shortAddress } from "@/lib/format";
import { GATEWAY_URL, CONTRACTS_CONFIGURED, L1_CHAIN_ID } from "@/lib/contracts";
import { StatusPill } from "@/components/StatusPill";
import { TokenLogo } from "@/components/TokenLogo";
import { BridgeForm } from "@/components/BridgeForm";
import { GeneralBridgeForm } from "@/components/GeneralBridgeForm";
import { TopUpForm } from "@/components/TopUpForm";
import { ExplorerPanel } from "@/components/ExplorerPanel";
import { RunwayMeter } from "@/components/brand/RunwayMeter";

export const dynamic = "force-dynamic";

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

  const [onchain, remainingRuntime, wrappedTokenRows] = await Promise.all([
    getOnchainChain(chainId),
    getRemainingRuntime(chainId),
    prisma.wrappedToken.findMany({ where: { chainDbId: dbChain.id }, orderBy: { createdAt: "asc" } }),
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
  const isTornDown = ["AWAITING_SNAPSHOT", "DEACTIVATING", "DEACTIVATED"].includes(dbChain.status);

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
        <StatusPill status={dbChain.status} />
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

      {!isActive && isTornDown && (
        <div className="rounded-2xl border border-dashed border-hairline-strong px-6 py-10 text-center text-sm text-bone-dim/50">
          <p>
            This chain has been torn down — its grace period expired and a final snapshot of
            every balance it had was taken.
          </p>
          <p className="mt-2">
            If you had funds on it,{" "}
            <Link href="/claim" className="text-bone underline underline-offset-2 hover:text-blood-bright">
              look up your wallet
            </Link>{" "}
            to claim them.
          </p>
        </div>
      )}

      {!isActive && !isTornDown && (
        <p className="rounded-2xl border border-dashed border-hairline-strong px-6 py-10 text-center text-sm text-bone-dim/50">
          This chain is {dbChain.status.replace(/_/g, " ").toLowerCase()} — the bridge and explorer
          become available once it&apos;s active.
        </p>
      )}
    </div>
  );
}
