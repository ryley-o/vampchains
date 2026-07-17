import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { Chain as ChainRow } from "@vampchains/db";
import type { Provisioner, ProvisionResult } from "./types.js";

const execFile = promisify(execFileCb);

export interface LocalDockerOptions {
  image: string;
  /// Attach the new container to this Docker network so other compose
  /// services (rpc-gateway, relayer) can reach it by container name instead
  /// of localhost:port. Leave unset for bare standalone use.
  network?: string;
  hostPortBase: number;
  /// The Clique block-signing key every vampchain node needs — same key
  /// reused across every chain by design, see docs/ARCHITECTURE.md.
  cliqueSignerPrivateKey: string;
}

function containerName(chain: ChainRow): string {
  return `vampchain-${chain.chainId}`;
}

/// Drives `docker` directly (shelling out, not the Docker Engine API) — this
/// is infra tooling, not a hot path, and the CLI is trivial to debug by
/// hand when something goes wrong.
export class LocalDockerProvisioner implements Provisioner {
  constructor(private opts: LocalDockerOptions) {}

  async provision(chain: ChainRow): Promise<ProvisionResult> {
    const name = containerName(chain);
    const hostPort = this.opts.hostPortBase + Number(chain.chainId % 1000n);
    const volumeName = `${name}-data`;

    await execFile("docker", ["volume", "create", volumeName]);

    const args = [
      "run",
      "-d",
      "--name",
      name,
      "-p",
      `${hostPort}:8545`,
      "-v",
      `${volumeName}:/data`,
      "-e",
      `CHAIN_ID=${chain.evmChainId}`,
      "-e",
      `CLIQUE_SIGNER_PRIVATE_KEY=${this.opts.cliqueSignerPrivateKey}`,
    ];
    if (this.opts.network) args.push("--network", this.opts.network);
    args.push(this.opts.image);

    await execFile("docker", args);
    await this.waitForHealthy(name);

    const rpcUrl = this.opts.network ? `http://${name}:8545` : `http://localhost:${hostPort}`;
    return { rpcUrl };
  }

  async deprovision(chain: ChainRow): Promise<void> {
    const name = containerName(chain);
    await execFile("docker", ["rm", "-f", name]).catch(() => {});
    // Volume deliberately left in place — cheap, and preserves a forensic
    // snapshot of final balances in case a "claim after teardown" mechanism
    // ever gets built (see docs/ARCHITECTURE.md known limitations). Prune
    // manually if disk space matters.
  }

  private async waitForHealthy(name: string, timeoutMs = 30_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const { stdout } = await execFile("docker", ["inspect", "--format", "{{.State.Health.Status}}", name]);
        if (stdout.trim() === "healthy") return;
      } catch {
        // container may not exist yet, or inspect is racing container start
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`container ${name} did not become healthy within ${timeoutMs}ms`);
  }
}
