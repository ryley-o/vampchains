import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { glob, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { StandardJsonInput } from "./standardJsonInput.js";

const execFile = promisify(execFileCb);

export interface CompileResult {
  abi: unknown[];
  /// Runtime (deployed) bytecode — what actually ends up in on-chain
  /// storage after a constructor runs, as opposed to the larger init code
  /// a deployment transaction sends. This is what gets compared against
  /// `eth_getCode`, never the init code.
  deployedBytecode: `0x${string}`;
}

export class CompileError extends Error {}

/// A source file path is a key straight out of a user-submitted
/// standard-json-input `sources` map — never trust it as a safe relative
/// path without checking first. Rejects absolute paths and any segment
/// that could escape the scratch directory.
function assertSafeRelativePath(p: string) {
  if (path.isAbsolute(p)) throw new CompileError(`source path "${p}" must be relative, not absolute`);
  const normalized = path.normalize(p);
  if (normalized.startsWith("..") || normalized.includes(`..${path.sep}`)) {
    throw new CompileError(`source path "${p}" escapes the project root`);
  }
}

/// Reconstructs a scratch Foundry project from a standard-json-input and
/// runs `forge build` against it — literally the Foundry toolchain doing
/// the compilation, the same one this repo's own contracts/ already uses,
/// not a bespoke solc wrapper. Every source file is written at exactly the
/// path its own sources-map key gives (so import resolution matches
/// whatever convention the submitter's own project used), `evmVersion` is
/// validated by the caller *before* this runs (never coerced here), and
/// the whole scratch directory — including whatever Foundry/svm caches it
/// creates — is removed afterward regardless of outcome.
export async function compileWithFoundry(
  input: StandardJsonInput,
  compilerVersion: string,
  contractName: string,
  timeoutMs: number
): Promise<CompileResult> {
  const projectDir = await mkdtemp(path.join(tmpdir(), "vamp-verify-"));

  try {
    for (const [sourcePath, { content }] of Object.entries(input.sources)) {
      assertSafeRelativePath(sourcePath);
      const fullPath = path.join(projectDir, sourcePath);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, "utf8");
    }

    const optimizer = input.settings?.optimizer;
    const foundryToml = `[profile.default]
src = "."
out = "out"
solc = "${compilerVersion}"
optimizer = ${optimizer?.enabled ? "true" : "false"}
optimizer_runs = ${optimizer?.runs ?? 200}
via_ir = ${input.settings?.viaIR ? "true" : "false"}
evm_version = "${input.settings?.evmVersion}"
`;
    await writeFile(path.join(projectDir, "foundry.toml"), foundryToml, "utf8");

    if (input.settings?.remappings?.length) {
      await writeFile(path.join(projectDir, "remappings.txt"), input.settings.remappings.join("\n") + "\n", "utf8");
    }

    try {
      await execFile("forge", ["build", "--force"], {
        cwd: projectDir,
        timeout: timeoutMs,
        // Isolated per-request FOUNDRY_HOME/cache dir avoids concurrent
        // compiles on the same instance stepping on each other's config
        // state, at the cost of re-resolving (not re-downloading — solc
        // binaries themselves are cached globally by svm regardless of
        // FOUNDRY_HOME) project config each time.
        env: { ...process.env, FOUNDRY_HOME: path.join(projectDir, ".foundry") },
        maxBuffer: 20 * 1024 * 1024,
      });
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? (err instanceof Error ? err.message : String(err));
      throw new CompileError(`forge build failed:\n${stderr}`);
    }

    const artifact = await findArtifact(projectDir, contractName);
    if (!artifact) {
      throw new CompileError(
        `compiled successfully, but no contract named "${contractName}" was found in the output — check the exact contract name (case-sensitive)`
      );
    }

    const parsed = JSON.parse(artifact) as { abi: unknown[]; deployedBytecode?: { object?: string } };
    const deployedBytecode = parsed.deployedBytecode?.object;
    if (!deployedBytecode) {
      throw new CompileError(`"${contractName}" has no deployed bytecode — is it an abstract contract or interface?`);
    }

    return {
      abi: parsed.abi,
      deployedBytecode: (deployedBytecode.startsWith("0x") ? deployedBytecode : `0x${deployedBytecode}`) as `0x${string}`,
    };
  } finally {
    await rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function findArtifact(projectDir: string, contractName: string): Promise<string | null> {
  const outDir = path.join(projectDir, "out");
  for await (const entry of glob(`**/${contractName}.json`, { cwd: outDir })) {
    return readFile(path.join(outDir, entry), "utf8");
  }
  return null;
}
