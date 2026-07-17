import type { Address } from "viem";

/// VampWrappedTokenFactory's address — baked into every vampchain's genesis
/// alloc at this exact fixed address (see
/// infra/sidechain-node/genesis.template.json and
/// contracts/src/VampWrappedTokenFactory.sol, which hardcodes the same
/// value as a compile-time constant). Same address on every vampchain by
/// design, so this is a constant here rather than per-chain configuration.
export const WRAPPED_TOKEN_FACTORY_ADDRESS: Address = "0x000000000000000000000000000000000000fac7";
