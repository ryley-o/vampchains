import Link from "next/link";
import { prisma } from "@vampchains/db";
import { getRemainingRuntime } from "@/lib/registryReads";
import { formatDuration, shortAddress } from "@/lib/format";
import { CONTRACTS_CONFIGURED } from "@/lib/contracts";
import { StatusPill } from "@/components/StatusPill";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const chains = await prisma.chain.findMany({ orderBy: { createdAt: "desc" } });

  const withRuntime = await Promise.all(
    chains.map(async (chain) => ({
      chain,
      remainingRuntime: await getRemainingRuntime(chain.chainId),
    }))
  );

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold">Pick a token. Get a chain.</h1>
        <p className="mt-2 max-w-2xl text-neutral-400">
          Anyone can turn an existing ERC20 into the native gas currency of its own tiny meme
          sidechain. Pay the annual fee, bridge the token in, and go build whatever you want on
          it.
        </p>
        {!CONTRACTS_CONFIGURED && (
          <p className="mt-4 rounded border border-yellow-700 bg-yellow-950/40 px-4 py-2 text-sm text-yellow-300">
            Contracts aren&apos;t configured yet (<code>NEXT_PUBLIC_REGISTRY_ADDRESS</code> is
            unset) — funding data below won&apos;t load until you deploy and set env vars. See
            docs/DEPLOYMENT.md.
          </p>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Live vampchains</h2>
          <Link href="/create" className="text-sm text-red-400 hover:underline">
            + create one
          </Link>
        </div>

        {chains.length === 0 ? (
          <p className="mt-4 text-neutral-500">No chains yet. Be the first.</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {withRuntime.map(({ chain, remainingRuntime }) => (
              <Link
                key={chain.id}
                href={`/chains/${chain.chainId}`}
                className="rounded-lg border border-neutral-800 p-4 transition hover:border-red-700 hover:bg-neutral-900"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{chain.name}</span>
                  <StatusPill status={chain.status} />
                </div>
                <p className="mt-1 text-sm text-neutral-400">
                  ${chain.symbol} · base token {shortAddress(chain.baseToken)}
                </p>
                <p className="mt-3 text-xs text-neutral-500">
                  Runway: {formatDuration(remainingRuntime)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
