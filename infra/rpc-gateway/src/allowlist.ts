/// Everything a normal wallet/dApp legitimately needs, and nothing else.
/// Deliberately excludes the entire `personal_*`/`miner_*`/`admin_*`/
/// `debug_*`/`txpool_*` namespaces — the Clique signer's unlocked account
/// is how deposits get minted, and if account-management methods were
/// reachable through this public gateway, anyone could self-mint native
/// currency and bypass VampBridge entirely. This allowlist is the security
/// boundary that makes it safe for this gateway to be public while the
/// vampchain nodes themselves stay off the public internet.
export const ALLOWED_METHODS: ReadonlySet<string> = new Set([
  "web3_clientVersion",
  "net_version",
  "net_listening",
  "net_peerCount",
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getTransactionCount",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getBlockTransactionCountByNumber",
  "eth_getBlockTransactionCountByHash",
  "eth_getTransactionByHash",
  "eth_getTransactionByBlockHashAndIndex",
  "eth_getTransactionByBlockNumberAndIndex",
  "eth_getTransactionReceipt",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getLogs",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_sendRawTransaction",
  "eth_syncing",
  "eth_accounts",
]);

export function isAllowedMethod(method: unknown): method is string {
  return typeof method === "string" && ALLOWED_METHODS.has(method);
}
