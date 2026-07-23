import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@vampchains/db";
import { ChainGate } from "@/components/ChainGate";
import { LiveTxDetail } from "@/components/LiveTxDetail";

export const dynamic = "force-dynamic";

export default async function TxDetailPage({ params }: { params: Promise<{ evmChainId: string; txHash: string }> }) {
  const { evmChainId, txHash } = await params;

  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) notFound();

  const chain = await prisma.chain.findUnique({ where: { evmChainId: BigInt(evmChainId) } });
  if (!chain) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-5 py-14">
      <div>
        <Link href={`/${evmChainId}`} className="text-xs text-bone-dim/50 hover:text-bone-dim">
          ← {chain.name}
        </Link>
        <h1 className="text-display mt-1.5 break-all text-2xl text-bone sm:text-3xl">Transaction</h1>
        <p className="mt-1 break-all font-mono text-sm text-bone-dim/50">{txHash}</p>
      </div>

      <ChainGate status={chain.status}>
        <LiveTxDetail evmChainId={evmChainId} txHash={txHash as `0x${string}`} />
      </ChainGate>
    </div>
  );
}
