import { isAddress, getAddress } from "viem";
import { prisma } from "@vampchains/db";
import type { VerifierConfig } from "./config.js";
import { verifyContract, type VerifyOutcome } from "./verify.js";
import type { StandardJsonInput } from "./standardJsonInput.js";

/// This is the entire reason infra/verifier can say "works with Foundry":
/// `forge verify-contract --verifier custom --verifier-url <url>` speaks
/// Etherscan's classic contract-verification API on the wire (module=
/// contract&action=verifysourcecode, then action=checkverifystatus to
/// poll) — implementing just enough of that surface here means a user's
/// own, unmodified Foundry install can verify against us directly, no
/// changes needed on their side at all.
///
/// Real Etherscan queues a verification job and makes you poll a GUID
/// because their compile step is slow and shared infrastructure; ours
/// runs synchronously per request (compiling one small contract is fast),
/// so this in-memory map just lets the required two-step protocol still
/// work — submit now, "poll" a result that's already sitting there.
/// Ephemeral by design: a lost result on restart just means re-submitting,
/// nothing is lost from VerifiedContract itself since that's already
/// durably written to Postgres by the time a GUID exists.
const pendingResults = new Map<string, VerifyOutcome>();
const RESULT_TTL_MS = 10 * 60_000;

setInterval(() => {
  // No timestamps kept per-entry deliberately (this map is tiny and
  // short-lived by construction — a verification's GUID is only ever
  // polled a few times, seconds apart) — just cap total size defensively.
  if (pendingResults.size > 1000) pendingResults.clear();
}, RESULT_TTL_MS).unref();

function parseCompilerVersion(raw: string): string {
  // Etherscan's format is "v0.8.24+commit.e11b9ed9" — forge/svm only wants
  // the bare "0.8.24".
  const match = /^v?(\d+\.\d+\.\d+)/.exec(raw);
  return match ? match[1] : raw;
}

function parseContractName(raw: string): string {
  // Etherscan's format is "path/To/File.sol:ContractName".
  const idx = raw.lastIndexOf(":");
  return idx === -1 ? raw : raw.slice(idx + 1);
}

export async function handleVerifySourceCode(
  params: URLSearchParams,
  config: VerifierConfig,
  evmChainId: string
): Promise<{ status: "1" | "0"; message: string; result: string }> {
  const address = params.get("contractaddress") ?? "";
  const codeformat = params.get("codeformat") ?? "";
  const sourceCodeRaw = params.get("sourceCode") ?? "";
  const contractname = params.get("contractname") ?? "";
  const compilerversion = params.get("compilerversion") ?? "";
  // Etherscan's API has always had this misspelling ("Arguements") alongside
  // the correct one — forge's real request sends both with the same value
  // (confirmed via live testing), so accept whichever is present.
  const constructorArgs = params.get("constructorArguments") || params.get("constructorArguements") || undefined;

  if (codeformat !== "solidity-standard-json-input") {
    return { status: "0", message: "NOTOK", result: "only codeformat=solidity-standard-json-input is supported" };
  }

  let standardJsonInput: StandardJsonInput;
  try {
    standardJsonInput = JSON.parse(sourceCodeRaw);
  } catch {
    return { status: "0", message: "NOTOK", result: "sourceCode is not valid JSON" };
  }

  const outcome = await verifyContract(
    {
      evmChainId,
      address,
      contractName: parseContractName(contractname),
      compilerVersion: parseCompilerVersion(compilerversion),
      standardJsonInput,
      constructorArgs,
    },
    config
  );

  const guid = crypto.randomUUID();
  pendingResults.set(guid, outcome);
  return { status: "1", message: "OK", result: guid };
}

/// `forge verify-contract` checks whether a contract is already verified
/// (action=getabi) before submitting a new verification — real Etherscan
/// returns a recognizable "not verified yet" shape for an unknown address
/// rather than an error, and forge's client only tolerates that specific
/// shape; anything else it treats as a hard failure. This has to exist for
/// `forge verify-contract` to work at all, not just as a nicety.
///
/// A bare address is never safely unique here on its own (the same L1
/// token bridged into two different vampchains gets the identical
/// wrapped-clone address on both, see
/// contracts/src/VampWrappedTokenFactory.sol) — but `evmChainId` arrives
/// from the URL path segment (server.ts), not from forge's request body
/// (forge's own getabi call carries no chain id at all), so the compound
/// key is actually available here and this can be a real lookup.
export async function handleGetAbi(
  evmChainId: string,
  addressRaw: string
): Promise<{ status: "1" | "0"; message: string; result: string }> {
  if (!isAddress(addressRaw)) {
    return { status: "0", message: "NOTOK", result: "Contract source code not verified" };
  }
  let chainIdBig: bigint;
  try {
    chainIdBig = BigInt(evmChainId);
  } catch {
    return { status: "0", message: "NOTOK", result: "Contract source code not verified" };
  }

  const chain = await prisma.chain.findUnique({ where: { evmChainId: chainIdBig } });
  if (!chain) return { status: "0", message: "NOTOK", result: "Contract source code not verified" };

  const address = getAddress(addressRaw);
  const existing = await prisma.verifiedContract.findUnique({
    where: { chainDbId_address: { chainDbId: chain.id, address } },
  });
  if (!existing) return { status: "0", message: "NOTOK", result: "Contract source code not verified" };

  return { status: "1", message: "OK", result: JSON.stringify(existing.abi) };
}

export function handleCheckVerifyStatus(params: URLSearchParams): { status: "1" | "0"; message: string; result: string } {
  const guid = params.get("guid") ?? "";
  const outcome = pendingResults.get(guid);
  if (!outcome) return { status: "0", message: "NOTOK", result: "Unknown GUID" };

  if (outcome.success) {
    return { status: "1", message: "OK", result: `Pass - Verified (${outcome.matchType} match)` };
  }
  return { status: "0", message: "NOTOK", result: `Fail - ${outcome.error ?? "verification failed"}` };
}
