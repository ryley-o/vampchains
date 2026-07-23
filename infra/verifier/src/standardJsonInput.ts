/// Solidity Standard JSON Input — the one canonical, machine-generated
/// document `forge verify-contract` already sends on the wire to any
/// Etherscan-compatible `--verifier custom` endpoint, and the format
/// Etherscan/Sourcify themselves settled on for the same reason: it
/// captures compiler version, optimizer settings, evmVersion, and
/// remappings all at once, so there's no way for hand-filled form fields
/// to drift from what was actually compiled. See docs on
/// infra/verifier/src/verify.ts for the rest of the pipeline this feeds.
export interface StandardJsonInput {
  language: "Solidity";
  sources: Record<string, { content: string }>;
  settings?: {
    optimizer?: { enabled?: boolean; runs?: number };
    evmVersion?: string;
    viaIR?: boolean;
    remappings?: string[];
    libraries?: Record<string, Record<string, string>>;
    outputSelection?: Record<string, Record<string, string[]>>;
  };
}

/// Every EVM target a vampchain can actually run — genesis is hard-capped
/// at London forever (no post-London fork blocks, no mergeNetsplitBlock/
/// shanghaiTime/cancunTime, no terminalTotalDifficulty — see
/// infra/sidechain-node/genesis.template.json). solc versions from 0.8.20
/// onward default to emitting PUSH0 (a Shanghai+ opcode) unless told
/// otherwise, so a submission that doesn't explicitly pin evmVersion here
/// is a real, common failure mode, not a hypothetical one.
export const ALLOWED_EVM_VERSIONS = new Set([
  "homestead",
  "tangerineWhistle",
  "spuriousDragon",
  "byzantium",
  "constantinople",
  "petersburg",
  "istanbul",
  "berlin",
  "london",
]);

export function validateEvmVersion(evmVersion: string | undefined): string | null {
  if (!evmVersion) {
    return "settings.evmVersion is required — this vampchain is hard-capped at the London fork forever, and solc defaults to a later target unless told otherwise. Add \"evmVersion\": \"london\" (or an earlier fork) to your standard-json-input settings and recompile.";
  }
  if (!ALLOWED_EVM_VERSIONS.has(evmVersion)) {
    return `evmVersion "${evmVersion}" targets a fork later than London, which this vampchain can never execute (its genesis has no fork blocks past London). Recompile with "evmVersion": "london" or earlier.`;
  }
  return null;
}
