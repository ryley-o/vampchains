import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { prisma } from "@vampchains/db";

/// Looks up every snapshot entitlement for a wallet address, across every
/// chain that's ever been deactivated — the "look up your wallet, see if
/// you have anything to withdraw" flow for chains whose grace period has
/// expired and infra's been torn down (see docs/ARCHITECTURE.md "Protocol
/// fee revenue" and VampBridge.claimSnapshot). `SnapshotEntitlement` rows
/// are populated once by the provisioner right as each chain's snapshot is
/// published; the proof stored here is exactly what `claimSnapshot` needs.
export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address");
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "missing or invalid ?address=" }, { status: 400 });
  }

  const rows = await prisma.snapshotEntitlement.findMany({
    where: { address: getAddress(address) },
    include: { chain: { select: { chainId: true, name: true, symbol: true, baseTokenSymbol: true } } },
    orderBy: { createdAt: "desc" },
  });

  const claims = rows.map((row) => ({
    chainId: row.chain.chainId.toString(),
    chainName: row.chain.name,
    chainSymbol: row.chain.symbol,
    token: row.token,
    amount: row.amount,
    proof: JSON.parse(row.proof) as string[],
    claimed: row.claimed,
  }));

  return NextResponse.json({ address: getAddress(address), claims });
}
