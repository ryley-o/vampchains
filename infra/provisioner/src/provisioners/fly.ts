import type { Chain as ChainRow } from "@vampchains/db";
import type { Provisioner, ProvisionResult } from "./types.js";

const FLY_API_BASE = "https://api.machines.dev/v1";

export interface FlyOptions {
  apiToken: string;
  orgSlug: string;
  image: string;
  region: string;
}

function appName(chain: ChainRow): string {
  return `vampchain-${chain.chainId}`;
}

/// Provisions one Fly app + one Fly Machine per vampchain via the Fly
/// Machines REST API (https://api.machines.dev/v1). NOTE: written against
/// Fly's documented API shape but not exercised against a real Fly org in
/// this session (no credentials available) — treat as a solid starting
/// point that needs a live smoke test with a real FLY_API_TOKEN before
/// depending on it, not as a verified implementation. LocalDockerProvisioner
/// is the one that's actually been run end-to-end.
export class FlyProvisioner implements Provisioner {
  constructor(private opts: FlyOptions) {}

  private async fly<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${FLY_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.opts.apiToken}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Fly API ${init?.method ?? "GET"} ${path} -> ${res.status}: ${body}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async provision(chain: ChainRow): Promise<ProvisionResult> {
    const name = appName(chain);

    await this.fly("/apps", {
      method: "POST",
      body: JSON.stringify({ app_name: name, org_slug: this.opts.orgSlug }),
    });

    const volumeName = "data";
    await this.fly(`/apps/${name}/volumes`, {
      method: "POST",
      body: JSON.stringify({ name: volumeName, region: this.opts.region, size_gb: 1 }),
    });

    await this.fly(`/apps/${name}/machines`, {
      method: "POST",
      body: JSON.stringify({
        name: `${name}-node`,
        region: this.opts.region,
        config: {
          image: this.opts.image,
          env: {
            CHAIN_ID: chain.evmChainId.toString(),
            PORT: "8545",
            STATE_DIR: "/data",
            STATE_INTERVAL: "30",
          },
          guest: { cpu_kind: "shared", cpus: 1, memory_mb: 256 },
          mounts: [{ volume: volumeName, path: "/data" }],
          // No public services block — this app is only ever reached over
          // Fly's private 6PN network, by the relayer and infra/rpc-gateway.
          services: [
            {
              protocol: "tcp",
              internal_port: 8545,
              ports: [],
            },
          ],
        },
      }),
    });

    return {
      rpcUrl: `http://${name}.internal:8545`,
      flyAppName: name,
    };
  }

  async deprovision(chain: ChainRow): Promise<void> {
    const name = appName(chain);
    // Deleting the app tears down its machine(s) too. Volumes are NOT
    // deleted by this call — same "keep it around as a forensic snapshot"
    // reasoning as LocalDockerProvisioner; clean up manually if needed.
    await this.fly(`/apps/${name}`, { method: "DELETE" }).catch((err) => {
      console.warn(`[fly] failed to delete app ${name} (may already be gone):`, err);
    });
  }
}
