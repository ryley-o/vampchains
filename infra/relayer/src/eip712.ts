import type { Address, Hex } from "viem";
import type { privateKeyToAccount } from "viem/accounts";

type SigningAccount = ReturnType<typeof privateKeyToAccount>;

export interface ClaimMessage {
  vampChainId: bigint;
  to: Address;
  amount: bigint;
  sidechainTxHash: Hex;
}

export interface ClaimTokenMessage {
  vampChainId: bigint;
  token: Address;
  to: Address;
  amount: bigint;
  sidechainTxHash: Hex;
}

/// Must match VampBridge.sol's domain and CLAIM_TYPEHASH exactly — see
/// `_domainNameAndVersion()` and `CLAIM_TYPEHASH` there. No app-level
/// verification of that match exists beyond the live claim() call itself
/// reverting with InvalidSignature() if it ever drifts, which is exactly
/// what happened (and was caught) during this project's own testing.
const CLAIM_TYPES = {
  Claim: [
    { name: "vampChainId", type: "uint256" },
    { name: "to", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "sidechainTxHash", type: "bytes32" },
  ],
} as const;

/// Distinct from CLAIM_TYPES on purpose — must match VampBridge.sol's
/// CLAIM_TOKEN_TYPEHASH exactly. A different typehash means a claim() and a
/// claimToken() signature can never be replayed against each other, even
/// with identical field values (see VampBridge.t.sol's
/// test_claimToken_revertsOnCrossPathReplayFromNativeClaim).
const CLAIM_TOKEN_TYPES = {
  ClaimToken: [
    { name: "vampChainId", type: "uint256" },
    { name: "token", type: "address" },
    { name: "to", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "sidechainTxHash", type: "bytes32" },
  ],
} as const;

/// Pure signing — no transaction, no gas, no L1 wallet balance required.
/// This is the whole point of the pull-claim design: the relayer's signing
/// key only ever needs to exist and stay secret, never to hold funds.
export async function signClaim(
  account: SigningAccount,
  params: { l1ChainId: number; bridgeAddress: Address; claim: ClaimMessage }
): Promise<Hex> {
  return account.signTypedData({
    domain: {
      name: "VampBridge",
      version: "1",
      chainId: params.l1ChainId,
      verifyingContract: params.bridgeAddress,
    },
    types: CLAIM_TYPES,
    primaryType: "Claim",
    message: params.claim,
  });
}

/// Same domain, distinct typehash — see CLAIM_TOKEN_TYPES above.
export async function signClaimToken(
  account: SigningAccount,
  params: { l1ChainId: number; bridgeAddress: Address; claim: ClaimTokenMessage }
): Promise<Hex> {
  return account.signTypedData({
    domain: {
      name: "VampBridge",
      version: "1",
      chainId: params.l1ChainId,
      verifyingContract: params.bridgeAddress,
    },
    types: CLAIM_TOKEN_TYPES,
    primaryType: "ClaimToken",
    message: params.claim,
  });
}
