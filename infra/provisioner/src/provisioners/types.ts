import type { Chain as ChainRow } from "@vampchains/db";

export interface ProvisionResult {
  rpcUrl: string;
  flyAppName?: string;
}

export interface Provisioner {
  provision(chain: ChainRow): Promise<ProvisionResult>;
  deprovision(chain: ChainRow): Promise<void>;
}
