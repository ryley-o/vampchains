import type { Chain as ChainRow } from "@vampchains/db";

export interface ProvisionResult {
  rpcUrl: string;
  flyAppName?: string;
}

export interface Provisioner {
  provision(chain: ChainRow): Promise<ProvisionResult>;
  /// Snapshots the chain's persistent volume before `deprovision` destroys
  /// anything — insurance in case the snapshot-claim Merkle tree
  /// (snapshotBuilder.ts) ever turns out to have missed something, so the
  /// real final state can still be inspected and manually reconciled
  /// later rather than being gone forever. Called unconditionally right
  /// before `deprovision` in the teardown sequence (see
  /// lifecycleWorker.ts's `teardownDeactivatingChains`).
  backup(chain: ChainRow): Promise<void>;
  deprovision(chain: ChainRow): Promise<void>;
}
