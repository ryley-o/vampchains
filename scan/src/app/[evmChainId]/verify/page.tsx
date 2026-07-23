import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@vampchains/db";
import { VerifyForm } from "@/components/VerifyForm";

export const dynamic = "force-dynamic";

export default async function VerifyPage({ params }: { params: Promise<{ evmChainId: string }> }) {
  const { evmChainId: evmChainIdParam } = await params;

  let evmChainId: bigint;
  try {
    evmChainId = BigInt(evmChainIdParam);
  } catch {
    notFound();
  }

  const chain = await prisma.chain.findUnique({ where: { evmChainId } });
  if (!chain) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-5 py-14">
      <div>
        <Link href={`/${evmChainIdParam}/contracts`} className="text-xs text-bone-dim/50 hover:text-bone-dim">
          ← {chain.name} verified contracts
        </Link>
        <h1 className="text-display mt-1.5 text-2xl text-bone sm:text-3xl">Verify a contract</h1>
        <p className="mt-2 max-w-xl text-sm text-bone-dim/60">
          Submit standard Solidity source and compiler settings — this is compiled with real Foundry
          (<code className="font-mono text-xs">forge build</code>) and compared byte-for-byte against
          what&apos;s actually deployed at the address on {chain.name}. Every vampchain&apos;s genesis is
          permanently capped at the London EVM fork, so <code className="font-mono text-xs">evm_version</code>{" "}
          is always submitted as <code className="font-mono text-xs">london</code> — if your local build
          targets a later fork (the default for solc 0.8.20+ unless pinned), recompile with{" "}
          <code className="font-mono text-xs">evm_version = &quot;london&quot;</code> first or verification
          will correctly fail rather than silently pass.
        </p>
        <p className="mt-3 max-w-xl text-xs text-bone-dim/40">
          Prefer Foundry directly?{" "}
          <code className="font-mono">
            forge verify-contract &lt;address&gt; &lt;Contract&gt; --chain {evmChainIdParam} --verifier custom
            --verifier-url {"{verifier-url}"}/etherscan-compat/api/{evmChainIdParam}
          </code>{" "}
          works unmodified against this same service.
        </p>
      </div>

      <VerifyForm evmChainId={evmChainIdParam} />
    </div>
  );
}
