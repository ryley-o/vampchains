import { GENESIS_CONTRACTS } from "@vampchains/contract-abis";

// Solady's LibClone (what VampWrappedTokenFactory actually deploys with)
// produces a different, gas-optimized minimal-proxy bytecode than the
// canonical EIP-1167 reference template — these constants previously held
// the canonical template's prefix/suffix despite this function's own
// docstring claiming otherwise, so every real wrapped-token clone silently
// fell through to "unrecognized" instead of ever matching. Caught live by
// actually bridging a token and checking scan/'s output, not by reading
// the code: confirmed via `eth_getCode` against a real deployed clone —
// 0x3d3d3d3d363d3d37363d73<20-byte impl address>5af43d3d93803e602a57fd5bf3.
const EIP1167_PREFIX = "3d3d3d3d363d3d37363d73";
const EIP1167_SUFFIX = "5af43d3d93803e602a57fd5bf3";

/// If `bytecode` is a Solady LibClone minimal proxy (the exact format
/// VampWrappedTokenFactory deploys with), returns the embedded
/// implementation address it delegates to. Otherwise null.
function parseEip1167Implementation(bytecode: `0x${string}`): `0x${string}` | null {
  const code = bytecode.toLowerCase().slice(2);
  if (!code.startsWith(EIP1167_PREFIX) || !code.endsWith(EIP1167_SUFFIX)) return null;
  const implHex = code.slice(EIP1167_PREFIX.length, EIP1167_PREFIX.length + 40);
  if (implHex.length !== 40) return null;
  return `0x${implHex}`;
}

export type ContractRecognition =
  | { kind: "genesis-factory" }
  | { kind: "genesis-implementation" }
  | { kind: "wrapped-token-clone" }
  | { kind: "unrecognized" }
  | { kind: "eoa" };

/// Classifies an address purely from its `eth_getCode` result — no
/// compilation, no database lookup for the first three cases. The two
/// genesis contracts are the same bytecode at the same address on every
/// vampchain, forever (see GENESIS_CONTRACTS' docstring), so an address
/// match alone is sufficient proof of identity. Every wrapped-token clone
/// is the same EIP-1167 stub pointing at the same implementation constant
/// on every chain, so pattern-matching the stub is sufficient too — no need
/// to know which specific L1 token it wraps to recognize *that* it's a
/// vampchain wrapped-token clone (that metadata comes from the WrappedToken
/// table, looked up separately once this function says "clone").
export function recognizeContract(address: `0x${string}`, code: `0x${string}` | null | undefined): ContractRecognition {
  if (!code || code === "0x") return { kind: "eoa" };

  const lowerAddress = address.toLowerCase();
  if (lowerAddress === GENESIS_CONTRACTS.wrappedTokenFactory.address) return { kind: "genesis-factory" };
  if (lowerAddress === GENESIS_CONTRACTS.wrappedTokenImplementation.address) return { kind: "genesis-implementation" };

  const implementation = parseEip1167Implementation(code);
  if (implementation === GENESIS_CONTRACTS.wrappedTokenImplementation.address) {
    return { kind: "wrapped-token-clone" };
  }

  return { kind: "unrecognized" };
}
