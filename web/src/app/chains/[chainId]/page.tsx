import { notFound } from "next/navigation";
import { prisma } from "@vampchains/db";
import { getOnchainChain, getRemainingRuntime } from "@/lib/registryReads";
import { formatDuration, formatUsdc, shortAddress } from "@/lib/format";
import { GATEWAY_URL, CONTRACTS_CONFIGURED } from "@/lib/contracts";
import { StatusPill } from "@/components/StatusPill";
import { BridgeForm } from "@/components/BridgeForm";
import { TopUpForm } from "@/components/TopUpForm";
import { ExplorerPanel } from "@/components/ExplorerPanel";

export const dynamic = "force-dynamic";

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

  const [onchain, remainingRuntime] = await Promise.all([
    getOnchainChain(chainId),
    getRemainingRuntime(chainId),
  ]);

  const gatewayRpcUrl = `${GATEWAY_URL}/rpc/${chainId}`;

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{dbChain.name}</h1>
          <StatusPill status={dbChain.status} />
        </div>
        <p className="mt-1 text-sm text-neutral-400">
          ${dbChain.symbol} · base token{" "}
          <span className="font-mono">{shortAddress(dbChain.baseToken)}</span> · vampchain id{" "}
          {dbChain.evmChainId.toString()}
        </p>
      </div>

      <section className="rounded-lg border border-neutral-800 p-4">
        <h2 className="font-semibold">Funding</h2>
        {!CONTRACTS_CONFIGURED || !onchain ? (
          <p className="mt-2 text-sm text-neutral-500">Live funding data unavailable right now.</p>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <p className="text-neutral-500">Balance</p>
              <p className="font-medium">${formatUsdc(onchain.fundingBalance)}</p>
            </div>
            <div>
              <p className="text-neutral-500">Annual fee</p>
              <p className="font-medium">${formatUsdc(onchain.annualFeeUSDC)}</p>
            </div>
            <div>
              <p className="text-neutral-500">Runway</p>
              <p className="font-medium">{formatDuration(remainingRuntime)}</p>
            </div>
            <div>
              <p className="text-neutral-500">Created</p>
              <p className="font-medium">{new Date(Number(onchain.createdAt) * 1000).toLocaleDateString()}</p>
            </div>
          </div>
        )}
        <div className="mt-4">
          <TopUpForm chainId={chainId} />
        </div>
      </section>

      {dbChain.status === "ACTIVE" && dbChain.rpcUrl && (
        <section className="rounded-lg border border-neutral-800 p-4">
          <h2 className="font-semibold">Bridge</h2>
          <div className="mt-3">
            <BridgeForm
              chainId={chainId}
              baseToken={dbChain.baseToken as `0x${string}`}
              baseTokenSymbol={dbChain.baseTokenSymbol}
              baseTokenDecimals={dbChain.baseTokenDecimals}
              evmChainId={dbChain.evmChainId}
              gatewayRpcUrl={gatewayRpcUrl}
            />
          </div>
        </section>
      )}

      {dbChain.status === "ACTIVE" && dbChain.rpcUrl && (
        <section className="rounded-lg border border-neutral-800 p-4">
          <h2 className="font-semibold">Explorer</h2>
          <p className="mt-1 text-xs text-neutral-500">
            RPC: <code className="font-mono">{gatewayRpcUrl}</code>
          </p>
          <div className="mt-3">
            <ExplorerPanel rpcUrl={gatewayRpcUrl} symbol={dbChain.baseTokenSymbol} />
          </div>
        </section>
      )}

      {dbChain.status !== "ACTIVE" && (
        <p className="text-sm text-neutral-500">
          This chain is {dbChain.status.replace(/_/g, " ").toLowerCase()} — the bridge and explorer
          become available once it&apos;s active.
        </p>
      )}
    </div>
  );
}
