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

export interface ClaimSweptMessage {
  vampChainId: bigint;
  amount: bigint;
  sidechainTxHash: Hex;
}

export interface BurnedFeesMessage {
  vampChainId: bigint;
  cumulativeBurned: bigint;
  asOfBlock: bigint;
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

/// Must match VampBridge.sol's CLAIM_SWEPT_TYPEHASH exactly. No `to` field —
/// claimSwept() always splits 50/50 between the protocol treasury and the
/// chain's creator, both read live from the registry, never caller-supplied.
const CLAIM_SWEPT_TYPES = {
  ClaimSwept: [
    { name: "vampChainId", type: "uint256" },
    { name: "amount", type: "uint256" },
    { name: "sidechainTxHash", type: "bytes32" },
  ],
} as const;

/// Must match VampBridge.sol's BURNED_FEES_TYPEHASH exactly. Attests to a
/// *cumulative* total, not a discrete event — claimBurnedFees() only ever
/// pays out the increment over what it's already paid, so resubmitting a
/// stale attestation is a harmless no-op rather than a double-pay.
const BURNED_FEES_TYPES = {
  BurnedFees: [
    { name: "vampChainId", type: "uint256" },
    { name: "cumulativeBurned", type: "uint256" },
    { name: "asOfBlock", type: "uint256" },
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

/// Same domain, distinct typehash — see CLAIM_SWEPT_TYPES above.
export async function signClaimSwept(
  account: SigningAccount,
  params: { l1ChainId: number; bridgeAddress: Address; claim: ClaimSweptMessage }
): Promise<Hex> {
  return account.signTypedData({
    domain: {
      name: "VampBridge",
      version: "1",
      chainId: params.l1ChainId,
      verifyingContract: params.bridgeAddress,
    },
    types: CLAIM_SWEPT_TYPES,
    primaryType: "ClaimSwept",
    message: params.claim,
  });
}

/// Same domain, distinct typehash — see BURNED_FEES_TYPES above.
export async function signBurnedFees(
  account: SigningAccount,
  params: { l1ChainId: number; bridgeAddress: Address; claim: BurnedFeesMessage }
): Promise<Hex> {
  return account.signTypedData({
    domain: {
      name: "VampBridge",
      version: "1",
      chainId: params.l1ChainId,
      verifyingContract: params.bridgeAddress,
    },
    types: BURNED_FEES_TYPES,
    primaryType: "BurnedFees",
    message: params.claim,
  });
}
