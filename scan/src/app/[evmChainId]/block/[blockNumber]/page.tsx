import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@vampchains/db";
import { ChainGate } from "@/components/ChainGate";
import { LiveBlockDetail } from "@/components/LiveBlockDetail";

export const dynamic = "force-dynamic";

export default async function BlockDetailPage({
  params,
}: {
  params: Promise<{ evmChainId: string; blockNumber: string }>;
}) {
  const { evmChainId, blockNumber } = await params;

  let parsedBlockNumber: bigint;
  try {
    parsedBlockNumber = BigInt(blockNumber);
  } catch {
    notFound();
  }

  const chain = await prisma.chain.findUnique({ where: { evmChainId: BigInt(evmChainId) } });
  if (!chain) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-5 py-14">
      <div>
        <Link href={`/${evmChainId}`} className="text-xs text-bone-dim/50 hover:text-bone-dim">
          ← {chain.name}
        </Link>
        <h1 className="text-display mt-1.5 text-3xl text-bone">Block {parsedBlockNumber.toString()}</h1>
      </div>

      <ChainGate status={chain.status}>
        <LiveBlockDetail evmChainId={evmChainId} blockNumber={parsedBlockNumber.toString()} />
      </ChainGate>
    </div>
  );
}
