import type { Address } from "viem";
import { createPublicClient, http, toHex } from "viem";
import type { Chain as ChainRow } from "@vampchains/db";

const NATIVE_TRANSFER_GAS = 21_000n;

/// For a single active vampchain, checks the shared Clique signer/etherbase
/// address's native balance and, if it's above `dustThresholdWei`, submits
/// a plain value transfer from that address to `burnAddress` for (balance
/// minus a conservative gas reserve) — the same "send to treasury"
/// withdrawal signal a user's own burn would be, just originating from
/// protocol-controlled fee revenue instead of a user's wallet.
/// withdrawalWatcher.ts picks this up on its next pass and, recognizing the
/// sender as `cliqueSignerAddress`, signs a `ClaimSwept` attestation
/// instead of a plain `Claim` — see docs/ARCHITECTURE.md "Protocol fee
/// revenue".
///
/// Deliberately does NOT hold or need this account's private key: the
/// signer's key lives only in the vampchain-node's own keystore, unlocked
/// there for auto-mining (`--unlock`, `--allow-insecure-unlock`, see
/// infra/sidechain-node/entrypoint.sh). A plain `eth_sendTransaction`
/// against the node's own RPC has it sign locally with that already-
/// unlocked account, so this needs only network reachability to the
/// chain's internal RPC, never key material — same reasoning as the
/// treasury mint path in depositWatcher.ts, just via the raw JSON-RPC
/// method instead of a locally-signed viem wallet client, since there's no
/// local key to sign with here at all.
export async function sweepTips(
  chain: ChainRow,
  cliqueSignerAddress: Address,
  burnAddress: Address,
  dustThresholdWei: bigint
) {
  if (!chain.rpcUrl) return;
  const client = createPublicClient({ transport: http(chain.rpcUrl) });

  const balance = await client.getBalance({ address: cliqueSignerAddress });
  if (balance <= dustThresholdWei) return;

  // Explicit gas params (rather than letting the node fill in defaults) so
  // we know exactly how much of the balance the transaction itself will
  // consume, and can size `value` to sweep everything else. Overshooting
  // the fee estimate just leaves a little extra behind for next tick
  // (EIP-1559 refunds unused fee budget above what a block actually
  // charges) — never a failure mode, just a smaller sweep this round.
  const latestBlock = await client.getBlock();
  const baseFee = latestBlock.baseFeePerGas ?? 0n;
  const priorityFee = 1_000_000_000n; // 1 gwei — uncontested single-signer chain, nothing to bid against
  const maxFeePerGas = baseFee * 2n + priorityFee; // headroom against the next block's base fee moving
  const gasReserve = NATIVE_TRANSFER_GAS * maxFeePerGas;

  if (balance <= gasReserve) return; // whole balance would go to gas, nothing left worth sweeping
  const amount = balance - gasReserve;

  const txHash = (await client.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: cliqueSignerAddress,
        to: burnAddress,
        value: toHex(amount),
        gas: toHex(NATIVE_TRANSFER_GAS),
        maxFeePerGas: toHex(maxFeePerGas),
        maxPriorityFeePerGas: toHex(priorityFee),
      },
    ],
    // eth_sendTransaction relies on the node's own unlocked keystore to
    // sign — not part of viem's standard PublicClient-safe method set, so
    // this bypasses its normal typed schema.
  } as never)) as `0x${string}`;

  console.log(`[fee-sweep] chain ${chain.chainId}: swept ${amount} native wei from signer to burn address (tx ${txHash})`);
}
