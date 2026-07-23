import { createPublicClient, http, defineChain, isAddress, getAddress } from "viem";
import { prisma } from "@vampchains/db";
import { compileWithFoundry, CompileError } from "./compile.js";
import { compareBytecode } from "./bytecode.js";
import { validateEvmVersion, type StandardJsonInput } from "./standardJsonInput.js";
import type { VerifierConfig } from "./config.js";

export interface VerifyRequest {
  evmChainId: string;
  address: string;
  contractName: string;
  compilerVersion: string;
  standardJsonInput: StandardJsonInput;
  constructorArgs?: string;
}

export interface VerifyOutcome {
  success: boolean;
  matchType?: "full" | "partial";
  error?: string;
  abi?: unknown[];
}

/// The one canonical compile-and-match path — both scan/'s own web form and
/// the Etherscan-compatible endpoint (for `forge verify-contract`) funnel
/// into this. Never coerces evmVersion, never executes the compiled
/// contract (only ever `forge build`, a static bytecode diff, and an
/// `eth_getCode` read) — comparison, not execution, so there's no path
/// from a crafted submission to running arbitrary code with any privilege.
export async function verifyContract(req: VerifyRequest, config: VerifierConfig): Promise<VerifyOutcome> {
  if (!isAddress(req.address)) return { success: false, error: "invalid address" };
  let evmChainId: bigint;
  try {
    evmChainId = BigInt(req.evmChainId);
  } catch {
    return { success: false, error: "invalid evmChainId" };
  }

  const evmVersionError = validateEvmVersion(req.standardJsonInput.settings?.evmVersion);
  if (evmVersionError) return { success: false, error: evmVersionError };

  const totalBytes = Object.values(req.standardJsonInput.sources).reduce((sum, s) => sum + s.content.length, 0);
  if (totalBytes > config.maxSourceBytes) {
    return { success: false, error: `submission too large (${totalBytes} bytes, max ${config.maxSourceBytes})` };
  }

  const chain = await prisma.chain.findUnique({ where: { evmChainId } });
  if (!chain) return { success: false, error: `no vampchain found with evmChainId ${req.evmChainId}` };
  if (chain.status !== "ACTIVE" || !chain.rpcUrl) {
    return { success: false, error: `chain ${req.evmChainId} isn't active — nothing to verify against` };
  }

  const address = getAddress(req.address);

  let compiled;
  try {
    compiled = await compileWithFoundry(
      req.standardJsonInput,
      req.compilerVersion,
      req.contractName,
      config.compileTimeoutMs
    );
  } catch (err) {
    if (err instanceof CompileError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "compilation failed" };
  }

  const gatewayChain = defineChain({
    id: Number(evmChainId),
    name: `vampchain-${evmChainId}`,
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [`${config.gatewayUrl}/rpc/${evmChainId}`] } },
  });
  const client = createPublicClient({ chain: gatewayChain, transport: http(`${config.gatewayUrl}/rpc/${evmChainId}`) });

  const deployedCode = await client.getCode({ address }).catch(() => undefined);
  if (!deployedCode || deployedCode === "0x") {
    return { success: false, error: `no contract code found at ${address} on this chain` };
  }

  const matchType = compareBytecode(compiled.deployedBytecode, deployedCode);
  if (matchType === "none") {
    return {
      success: false,
      error:
        "compiled bytecode doesn't match what's deployed on-chain — check the compiler version, optimizer settings, and evmVersion exactly match what was used to deploy",
    };
  }

  await prisma.verifiedContract.upsert({
    where: { chainDbId_address: { chainDbId: chain.id, address } },
    create: {
      chainDbId: chain.id,
      chainId: chain.chainId,
      address,
      contractName: req.contractName,
      compilerVersion: req.compilerVersion,
      optimizerEnabled: !!req.standardJsonInput.settings?.optimizer?.enabled,
      optimizerRuns: req.standardJsonInput.settings?.optimizer?.runs ?? null,
      viaIr: !!req.standardJsonInput.settings?.viaIR,
      standardJsonInput: req.standardJsonInput as object,
      constructorArgs: req.constructorArgs ?? null,
      abi: compiled.abi as object,
      matchType,
    },
    update: {
      contractName: req.contractName,
      compilerVersion: req.compilerVersion,
      optimizerEnabled: !!req.standardJsonInput.settings?.optimizer?.enabled,
      optimizerRuns: req.standardJsonInput.settings?.optimizer?.runs ?? null,
      viaIr: !!req.standardJsonInput.settings?.viaIR,
      standardJsonInput: req.standardJsonInput as object,
      constructorArgs: req.constructorArgs ?? null,
      abi: compiled.abi as object,
      matchType,
      verifiedAt: new Date(),
    },
  });

  return { success: true, matchType, abi: compiled.abi };
}
