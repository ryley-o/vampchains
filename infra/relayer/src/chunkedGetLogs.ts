import type { AbiEvent, Address, GetLogsReturnType, PublicClient } from "viem";

/// Public RPC providers (Base Sepolia's included) cap eth_getLogs to a
/// small block range per call (commonly ~2000 blocks) — a single
/// fromBlock..toBlock query spanning a live chain's full history fails
/// outright. This chunks the range so scanning always succeeds, however far
/// behind the cursor has fallen.
export async function getLogsChunked<const event extends AbiEvent>(
  client: PublicClient,
  params: { address: Address; event: event; fromBlock: bigint; toBlock: bigint },
  maxRange = 1900n
): Promise<GetLogsReturnType<event>> {
  const logs: GetLogsReturnType<event> = [];
  let start = params.fromBlock;

  while (start <= params.toBlock) {
    const end = start + maxRange > params.toBlock ? params.toBlock : start + maxRange;
    const chunk = await client.getLogs({ address: params.address, event: params.event, fromBlock: start, toBlock: end });
    logs.push(...chunk);
    start = end + 1n;
  }

  return logs;
}
