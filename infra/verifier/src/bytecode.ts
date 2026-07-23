/// Strips the trailing CBOR-encoded metadata hash solc appends to every
/// contract's runtime bytecode. Standard solc convention: the final 2
/// bytes are a big-endian uint16 giving the byte length of the CBOR blob
/// that immediately precedes them — strip that blob plus its own 2-byte
/// length prefix. Used to compute a Sourcify-style "partial match": two
/// bytecodes that are byte-identical once this trailer is removed, even if
/// the metadata itself differs (e.g. trivial source whitespace/path
/// differences that solc's metadata hash is sensitive to but which don't
/// change actual behavior).
export function stripMetadataHash(bytecodeHex: string): string {
  const code = bytecodeHex.startsWith("0x") ? bytecodeHex.slice(2) : bytecodeHex;
  if (code.length < 4) return code.toLowerCase();

  const metadataLenHex = code.slice(-4);
  const metadataLen = Number.parseInt(metadataLenHex, 16);
  const trailerHexChars = (metadataLen + 2) * 2;
  if (!Number.isFinite(metadataLen) || trailerHexChars <= 0 || trailerHexChars > code.length) {
    return code.toLowerCase();
  }
  return code.slice(0, code.length - trailerHexChars).toLowerCase();
}

export type BytecodeMatch = "full" | "partial" | "none";

/// Compares a freshly-compiled contract's runtime bytecode against what's
/// actually deployed on-chain, using the same full/partial match
/// definitions Sourcify uses — see stripMetadataHash's docstring for what
/// "partial" means here.
export function compareBytecode(compiled: string, deployed: string): BytecodeMatch {
  const compiledNorm = compiled.startsWith("0x") ? compiled.slice(2).toLowerCase() : compiled.toLowerCase();
  const deployedNorm = deployed.startsWith("0x") ? deployed.slice(2).toLowerCase() : deployed.toLowerCase();

  if (compiledNorm === deployedNorm) return "full";
  if (stripMetadataHash(compiledNorm) === stripMetadataHash(deployedNorm)) return "partial";
  return "none";
}
