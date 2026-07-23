import VampChainRegistryAbiJson from "./abis/VampChainRegistry.json" with { type: "json" };
import VampBridgeAbiJson from "./abis/VampBridge.json" with { type: "json" };
import VampWrappedTokenAbiJson from "./abis/VampWrappedToken.json" with { type: "json" };
import VampWrappedTokenFactoryAbiJson from "./abis/VampWrappedTokenFactory.json" with { type: "json" };

/// Synced from Foundry's build artifacts by scripts/sync-abis.sh — never
/// hand-edited. One shared copy so web/, scan/, and infra/verifier can't
/// silently drift from each other or from what's actually deployed.
export const VAMP_CHAIN_REGISTRY_ABI = VampChainRegistryAbiJson;
export const VAMP_BRIDGE_ABI = VampBridgeAbiJson;
export const VAMP_WRAPPED_TOKEN_ABI = VampWrappedTokenAbiJson;
export const VAMP_WRAPPED_TOKEN_FACTORY_ABI = VampWrappedTokenFactoryAbiJson;

/// The two contracts baked into every vampchain's genesis `alloc` at fixed,
/// well-known addresses — identical bytecode on every chain, forever (see
/// contracts/src/VampWrappedTokenFactory.sol's docstring). These never need
/// per-chain or per-user verification: they're the same one contract,
/// everywhere, from block 0.
export const GENESIS_CONTRACTS = {
  // Both addresses read directly from infra/sidechain-node/genesis.template.json's
  // `alloc` — do not hand-edit without re-checking that file.
  wrappedTokenFactory: {
    address: "0x000000000000000000000000000000000000fac7" as `0x${string}`,
    name: "VampWrappedTokenFactory",
    abi: VAMP_WRAPPED_TOKEN_FACTORY_ABI,
  },
  wrappedTokenImplementation: {
    address: "0x00000000000000000000000000000000000010c0" as `0x${string}`,
    name: "VampWrappedToken",
    abi: VAMP_WRAPPED_TOKEN_ABI,
  },
} as const;
