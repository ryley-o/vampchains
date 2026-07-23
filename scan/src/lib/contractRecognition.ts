import { GENESIS_CONTRACTS } from "@vampchains/contract-abis";

const EIP1167_PREFIX = "363d3d373d3d3d363d73";
const EIP1167_SUFFIX = "5af43d82803e903d91602b57fd5bf3";

/// If `bytecode` is a standard EIP-1167 minimal proxy (the exact format
/// solady's LibClone.cloneDeterministic produces — no PUSH0 variant, which
/// matters since every vampchain is capped at the London fork), returns the
/// embedded implementation address it delegates to. Otherwise null.
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
