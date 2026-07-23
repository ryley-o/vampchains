import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { prisma } from "@vampchains/db";

/// Looks up how much gas a wallet has spent — "blood given" — across every
/// vampchain, for the personal lookup on /donors. Purely informational,
/// same as GasContribution itself: no claim, no signature, just an indexed
/// read.
export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address");
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "missing or invalid ?address=" }, { status: 400 });
  }

  const rows = await prisma.gasContribution.findMany({
    where: { address: getAddress(address).toLowerCase() },
    include: { chain: { select: { evmChainId: true, name: true, symbol: true } } },
    orderBy: { updatedAt: "desc" },
  });

  const contributions = rows.map((row) => ({
    evmChainId: row.chain.evmChainId.toString(),
    chainName: row.chain.name,
    chainSymbol: row.chain.symbol,
    amount: row.totalGasSpentNativeWei,
  }));

  return NextResponse.json({ address: getAddress(address), contributions });
}
