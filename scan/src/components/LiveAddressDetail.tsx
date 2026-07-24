"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatEther, parseAbiItem } from "viem";
import { getChainClient } from "@/lib/gatewayClient";
import { recognizeContract, type ContractRecognition } from "@/lib/contractRecognition";
import { GENESIS_CONTRACTS } from "@vampchains/contract-abis";
import { getHomeChainById } from "@vampchains/chains";
import { formatTokenAmount, shortAddress, shortHash, timeAgo } from "@/lib/format";
import { VerifiedContractTabs } from "@/components/VerifiedContractTabs";
import { AddressChip } from "@/components/AddressChip";
import { CopyButton } from "@/components/CopyButton";
import type { StandardJsonSources } from "@/lib/standardJsonInput";

interface VerifiedContractMeta {
  contractName: string;
  compilerVersion: string;
  matchType: string;
  abi: unknown[];
  sources: StandardJsonSources[];
}

interface CreationTx {
  txHash: string;
  blockNumber: string;
}

const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

interface TransferRow {
  txHash: `0x${string}`;
  from: `0x${string}`;
  to: `0x${string}`;
  value: bigint;
  blockNumber: bigint;
}

interface WrappedTokenMeta {
  name: string;
  symbol: string;
  decimals: number;
  l1Token: string;
}

interface TxActivityRow {
  txHash: string;
  blockNumber: string;
  from: string;
  to: string | null;
  valueNativeWei: string;
  status: string;
  timestamp: string;
}

export function LiveAddressDetail({
  evmChainId,
  address,
  chainSymbol,
  wrappedTokenMeta,
  isKnownL1TokenWrapped,
  txActivity,
  verifiedContract,
  creationTx,
  chainName,
  gatewayRpcUrl,
  homeChainId,
}: {
  evmChainId: string;
  address: `0x${string}`;
  chainSymbol: string;
  wrappedTokenMeta: WrappedTokenMeta | null;
  isKnownL1TokenWrapped: boolean;
  txActivity: TxActivityRow[];
  verifiedContract: VerifiedContractMeta | null;
  creationTx: CreationTx | null;
  chainName: string;
  gatewayRpcUrl: string;
  homeChainId: number;
}) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [recognition, setRecognition] = useState<ContractRecognition | null>(null);
  const [bytecode, setBytecode] = useState<`0x${string}` | null>(null);
  const [transfers, setTransfers] = useState<TransferRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const client = getChainClient(evmChainId);

    async function load() {
      try {
        const [bal, code] = await Promise.all([
          client.getBalance({ address }),
          client.getCode({ address }),
        ]);
        if (cancelled) return;
        setBalance(bal);
        setBytecode(code ?? null);
        const rec = recognizeContract(address, code ?? null);
        setRecognition(rec);

        // A token contract's own page wants "transfers OF this token" (any
        // holder), never "transfers where this address is a participant" —
        // a token practically never holds/sends itself, so the participant
        // query silently returns nothing for exactly the page where it
        // matters most (caught live: a real wrapped-token clone with real
        // mint/burn activity showed "No ERC20 transfers found" until this
        // was fixed). Every other address — including an EOA, which this
        // used to skip entirely — still wants the participant query: what
        // ERC20s has this address sent or received.
        const logs =
          rec.kind === "wrapped-token-clone"
            ? await client.getLogs({ address, event: TRANSFER_EVENT, fromBlock: 0n, toBlock: "latest" })
            : await Promise.all([
                client.getLogs({ event: TRANSFER_EVENT, args: { from: address }, fromBlock: 0n, toBlock: "latest" }),
                client.getLogs({ event: TRANSFER_EVENT, args: { to: address }, fromBlock: 0n, toBlock: "latest" }),
              ]).then(([outgoing, incoming]) => [...outgoing, ...incoming]);

        if (cancelled) return;
        const merged = logs
          .map((log) => ({
            txHash: log.transactionHash!,
            from: log.args.from!,
            to: log.args.to!,
            value: log.args.value!,
            blockNumber: log.blockNumber!,
          }))
          .sort((a, b) => (b.blockNumber > a.blockNumber ? 1 : -1))
          .slice(0, 25);
        setTransfers(merged);
      } catch {
        if (!cancelled) setError("Couldn't reach this chain's node through the gateway.");
      }
    }

    load();
  }, [evmChainId, address]);

  if (error) return <p className="text-sm text-blood-bright">{error}</p>;
  if (balance === null || recognition === null) return <p className="text-sm text-bone-dim/50">Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-hairline bg-ink-raised p-6">
        <p className="text-xs text-bone-dim/50">Balance</p>
        <p className="mt-1 font-mono text-2xl text-bone">
          {formatEther(balance)} <span className="text-sm text-bone-dim/50">${chainSymbol}</span>
        </p>
      </div>

      {creationTx && (
        <p className="text-xs text-bone-dim/50">
          Created in{" "}
          <Link href={`/${evmChainId}/tx/${creationTx.txHash}`} className="font-mono text-bone hover:text-blood-bright">
            {shortHash(creationTx.txHash)}
          </Link>{" "}
          at block{" "}
          <Link href={`/${evmChainId}/block/${creationTx.blockNumber}`} className="font-mono text-bone hover:text-blood-bright">
            {creationTx.blockNumber}
          </Link>
        </p>
      )}

      <RecognitionPanel
        recognition={recognition}
        wrappedTokenMeta={wrappedTokenMeta}
        isKnownL1TokenWrapped={isKnownL1TokenWrapped}
        verifiedContract={verifiedContract}
        evmChainId={evmChainId}
        address={address}
        bytecode={bytecode}
        chainName={chainName}
        chainSymbol={chainSymbol}
        gatewayRpcUrl={gatewayRpcUrl}
        homeChainId={homeChainId}
      />

      <div className="rounded-2xl border border-hairline bg-ink-raised p-6">
        <h2 className="text-display text-lg text-bone">Native transactions</h2>
        <p className="mt-1 text-xs text-bone-dim/40">
          Indexed from this chain&apos;s own node — may lag live activity by up to ~30s.
        </p>
        {txActivity.length === 0 ? (
          <p className="mt-4 text-sm text-bone-dim/50">No indexed native transactions found.</p>
        ) : (
          <table className="mt-4 w-full text-left text-sm">
            <thead className="font-mono text-[11px] uppercase tracking-wider text-bone-dim/40">
              <tr>
                <th className="pb-2 font-normal">Tx</th>
                <th className="pb-2 font-normal">Block</th>
                <th className="pb-2 font-normal">From</th>
                <th className="pb-2 font-normal">To</th>
                <th className="pb-2 font-normal">Value</th>
                <th className="pb-2 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {txActivity.map((t) => (
                <tr key={t.txHash} className="border-t border-hairline">
                  <td className="py-2.5">
                    <Link href={`/${evmChainId}/tx/${t.txHash}`} className="font-mono text-xs text-bone hover:text-blood-bright">
                      {shortHash(t.txHash)}
                    </Link>
                  </td>
                  <td className="py-2.5">
                    <Link href={`/${evmChainId}/block/${t.blockNumber}`} className="font-mono text-xs text-bone-dim hover:text-blood-bright">
                      {t.blockNumber}
                    </Link>
                  </td>
                  <td className="py-2.5">
                    <AddressChip
                      address={t.from}
                      href={`/${evmChainId}/address/${t.from}`}
                      linkClassName="text-xs text-bone-dim hover:text-blood-bright"
                    />
                  </td>
                  <td className="py-2.5">
                    {t.to ? (
                      <AddressChip
                        address={t.to}
                        href={`/${evmChainId}/address/${t.to}`}
                        linkClassName="text-xs text-bone-dim hover:text-blood-bright"
                      />
                    ) : (
                      <span className="font-mono text-xs text-bone-dim/40">contract creation</span>
                    )}
                  </td>
                  <td className="py-2.5 font-mono text-xs text-bone-dim/70">
                    {formatEther(BigInt(t.valueNativeWei))} ${chainSymbol}
                  </td>
                  <td className="py-2.5">
                    <span className={`font-mono text-xs ${t.status === "success" ? "text-emerald-300" : "text-blood-bright"}`}>
                      {t.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-2xl border border-hairline bg-ink-raised p-6">
          <h2 className="text-display text-lg text-bone">ERC20 transfers</h2>
          <p className="mt-1 text-xs text-bone-dim/40">
            Only ERC20 Transfer events — native-currency activity is in the &quot;Native transactions&quot;
            section above instead.
          </p>
          {!transfers ? (
            <p className="mt-4 text-sm text-bone-dim/50">Loading…</p>
          ) : transfers.length === 0 ? (
            <p className="mt-4 text-sm text-bone-dim/50">No ERC20 transfers found.</p>
          ) : (
            <table className="mt-4 w-full text-left text-sm">
              <thead className="font-mono text-[11px] uppercase tracking-wider text-bone-dim/40">
                <tr>
                  <th className="pb-2 font-normal">Tx</th>
                  <th className="pb-2 font-normal">From</th>
                  <th className="pb-2 font-normal">To</th>
                  <th className="pb-2 font-normal">Amount</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t, i) => (
                  <tr key={`${t.txHash}-${i}`} className="border-t border-hairline">
                    <td className="py-2.5">
                      <Link href={`/${evmChainId}/tx/${t.txHash}`} className="font-mono text-xs text-bone hover:text-blood-bright">
                        {shortHash(t.txHash)}
                      </Link>
                    </td>
                    <td className="py-2.5">
                      <AddressChip
                        address={t.from}
                        href={`/${evmChainId}/address/${t.from}`}
                        linkClassName="text-xs text-bone-dim hover:text-blood-bright"
                      />
                    </td>
                    <td className="py-2.5">
                      <AddressChip
                        address={t.to}
                        href={`/${evmChainId}/address/${t.to}`}
                        linkClassName="text-xs text-bone-dim hover:text-blood-bright"
                      />
                    </td>
                    <td className="py-2.5 font-mono text-xs text-bone-dim/70">
                      {wrappedTokenMeta ? formatTokenAmount(t.value, wrappedTokenMeta.decimals) : t.value.toString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  );
}

function RecognitionPanel({
  recognition,
  wrappedTokenMeta,
  isKnownL1TokenWrapped,
  verifiedContract,
  evmChainId,
  address,
  bytecode,
  chainName,
  chainSymbol,
  gatewayRpcUrl,
  homeChainId,
}: {
  recognition: ContractRecognition;
  wrappedTokenMeta: WrappedTokenMeta | null;
  isKnownL1TokenWrapped: boolean;
  verifiedContract: VerifiedContractMeta | null;
  evmChainId: string;
  address: `0x${string}`;
  bytecode: `0x${string}` | null;
  chainName: string;
  chainSymbol: string;
  gatewayRpcUrl: string;
  homeChainId: number;
}) {
  if (recognition.kind === "eoa") {
    return <p className="text-sm text-bone-dim/50">This is a wallet address (no contract code).</p>;
  }

  if (recognition.kind === "genesis-factory" || recognition.kind === "genesis-implementation") {
    const meta =
      recognition.kind === "genesis-factory" ? GENESIS_CONTRACTS.wrappedTokenFactory : GENESIS_CONTRACTS.wrappedTokenImplementation;
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-emerald-800/60 bg-emerald-950/20 p-6">
          <p className="font-mono text-xs uppercase tracking-wider text-emerald-300">Verified · genesis contract</p>
          <p className="mt-1 text-sm text-bone">
            {meta.name}
            {" "}
            — baked into every vampchain&apos;s genesis at this exact address. Same bytecode on every chain,
            forever.
          </p>
        </div>
        <VerifiedContractTabs
          evmChainId={evmChainId}
          address={address}
          abi={meta.abi}
          sources={null}
          githubUrl={`https://github.com/ryley-o/vampchains/blob/main/contracts/src/${meta.name}.sol`}
          chainName={chainName}
          chainSymbol={chainSymbol}
          gatewayRpcUrl={gatewayRpcUrl}
        />
      </div>
    );
  }

  if (recognition.kind === "wrapped-token-clone") {
    const homeChain = getHomeChainById(homeChainId);
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-emerald-800/60 bg-emerald-950/20 p-6">
          <p className="font-mono text-xs uppercase tracking-wider text-emerald-300">Verified · wrapped token clone</p>
          <p className="mt-1 text-sm text-bone">
            An EIP-1167 minimal proxy to VampWrappedToken — the standard clone every general-bridged ERC20
            gets, byte-identical across every vampchain.
          </p>
          {wrappedTokenMeta && (
            <p className="mt-2 font-mono text-xs text-bone-dim/60">
              {wrappedTokenMeta.name}
              {" "}($
              {wrappedTokenMeta.symbol}),{" "}
              {wrappedTokenMeta.decimals} decimals — wraps L1 token{" "}
              {homeChain ? (
                <>
                  <a
                    href={`${homeChain.blockExplorerUrl}/address/${wrappedTokenMeta.l1Token}`}
                    className="text-blood underline underline-offset-2 hover:text-blood-bright"
                  >
                    {shortAddress(wrappedTokenMeta.l1Token)} on {homeChain.name} →
                  </a>{" "}
                  <CopyButton value={wrappedTokenMeta.l1Token} />
                </>
              ) : (
                <AddressChip address={wrappedTokenMeta.l1Token} className="text-bone-dim/60" />
              )}
            </p>
          )}
        </div>
        <VerifiedContractTabs
          evmChainId={evmChainId}
          address={address}
          abi={GENESIS_CONTRACTS.wrappedTokenImplementation.abi}
          sources={null}
          githubUrl="https://github.com/ryley-o/vampchains/blob/main/contracts/src/VampWrappedToken.sol"
          chainName={chainName}
          chainSymbol={chainSymbol}
          gatewayRpcUrl={gatewayRpcUrl}
        />
      </div>
    );
  }

  if (verifiedContract) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-emerald-800/60 bg-emerald-950/20 p-6">
          <p className="font-mono text-xs uppercase tracking-wider text-emerald-300">
            Verified · {verifiedContract.matchType} match
          </p>
          <p className="mt-1 text-sm text-bone">{verifiedContract.contractName}</p>
          <p className="mt-1 font-mono text-xs text-bone-dim/60">solc {verifiedContract.compilerVersion}</p>
        </div>
        <VerifiedContractTabs
          evmChainId={evmChainId}
          address={address}
          abi={verifiedContract.abi}
          sources={verifiedContract.sources}
          chainName={chainName}
          chainSymbol={chainSymbol}
          gatewayRpcUrl={gatewayRpcUrl}
        />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-hairline bg-charcoal-soft/40 p-6">
      <p className="font-mono text-xs uppercase tracking-wider text-bone-dim/50">Unverified contract</p>
      <p className="mt-1 text-sm text-bone-dim/70">
        {isKnownL1TokenWrapped
          ? "This address is an L1 token that's been bridged here, not the contract deployed on this chain."
          : "No verified source available for this contract yet."}
      </p>
      {bytecode && <BytecodeToggle bytecode={bytecode} />}
    </div>
  );
}

function BytecodeToggle({ bytecode }: { bytecode: `0x${string}` }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="mt-3">
      <button onClick={() => setShown((s) => !s)} className="text-xs text-blood underline underline-offset-2 hover:text-blood-bright">
        {shown ? "Hide bytecode" : "Show bytecode"}
      </button>
      {shown && (
        <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-ink p-4 text-[11px] leading-relaxed text-bone-dim/70">
          <code className="break-all">{bytecode}</code>
        </pre>
      )}
    </div>
  );
}
