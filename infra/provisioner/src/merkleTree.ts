import { type Address, type Hex, encodeAbiParameters, keccak256 } from "viem";

export interface SnapshotLeafInput {
  token: Address; // the zero address for the chain's own base token (native path)
  address: Address;
  amount: bigint;
}

interface BuiltLeaf extends SnapshotLeafInput {
  hash: Hex;
}

export interface SnapshotTree {
  root: Hex;
  /// Same order as the input leaves — `proofs[i]` corresponds to `leaves[i]`.
  proofs: Hex[][];
}

/// Double-hashed leaf (OZ-style second-preimage mitigation: a leaf can never
/// collide with an internal node's `keccak256(a, b)` shape) — must match
/// VampBridge.sol's `claimSnapshot` exactly.
function hashLeaf(chainId: bigint, leaf: SnapshotLeafInput): Hex {
  const inner = keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
      [chainId, leaf.token, leaf.address, leaf.amount]
    )
  );
  return keccak256(inner);
}

/// Sorted-pair hashing — must match solady's `MerkleProofLib` exactly
/// (it hashes whichever of the two nodes is numerically smaller first).
function hashPair(a: Hex, b: Hex): Hex {
  const [lo, hi] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return keccak256(`0x${lo.slice(2)}${hi.slice(2)}`);
}

/// Builds a Merkle tree over `(chainId, token, address, amount)` leaves and
/// returns the root plus a proof array for every input leaf, in the same
/// order. Odd node counts at any level are promoted unchanged to the next
/// level (not duplicated) — an arbitrary but self-consistent convention,
/// since this same function both builds the root and generates every
/// proof, so nothing else needs to agree with it beyond
/// `VampBridge.claimSnapshot`'s leaf-hash and pair-hash formats above.
///
/// Always returns a non-empty tree: `VampBridge.publishSnapshot` rejects a
/// zero root, and a genuinely empty leaf set (every real holder already
/// withdrew before the chain died) still needs *some* published root so
/// `sweepUnclaimed` has a claim window to run its clock against later. In
/// that case this synthesizes a single sentinel leaf
/// `(chainId, 0x0, 0x0, 0)` — permanently unclaimable by construction,
/// since `claimSnapshot` rejects a zero `to` and a zero `amount` before it
/// ever reaches proof verification.
export function buildSnapshotTree(chainId: bigint, leaves: SnapshotLeafInput[]): SnapshotTree {
  const effectiveLeaves: SnapshotLeafInput[] =
    leaves.length > 0
      ? leaves
      : [{ token: "0x0000000000000000000000000000000000000000", address: "0x0000000000000000000000000000000000000000", amount: 0n }];

  const built: BuiltLeaf[] = effectiveLeaves.map((leaf) => ({ ...leaf, hash: hashLeaf(chainId, leaf) }));

  // Build the tree level by level, recording each node's sibling-path
  // trail so we can reconstruct every leaf's proof afterward.
  let level: Hex[] = built.map((l) => l.hash);
  const levels: Hex[][] = [level];
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(hashPair(level[i]!, level[i + 1]!));
      } else {
        next.push(level[i]!); // odd one out, promoted unchanged
      }
    }
    levels.push(next);
    level = next;
  }
  const root = level[0]!;

  const proofs: Hex[][] = built.map((_, leafIndex) => {
    const proof: Hex[] = [];
    let index = leafIndex;
    for (let d = 0; d < levels.length - 1; d++) {
      const currentLevel = levels[d]!;
      const isRightNode = index % 2 === 1;
      const siblingIndex = isRightNode ? index - 1 : index + 1;
      if (siblingIndex < currentLevel.length) {
        proof.push(currentLevel[siblingIndex]!);
      }
      index = Math.floor(index / 2);
    }
    return proof;
  });

  return { root, proofs };
}
