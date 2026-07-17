-- Pull-based claim withdrawals: the relayer signs an EIP-712 claim instead
-- of submitting a release() transaction, so we track the signature instead
-- of a release tx hash.
ALTER TABLE "WithdrawalEvent" ADD COLUMN "signature" TEXT;
ALTER TABLE "WithdrawalEvent" RENAME COLUMN "releaseTxHash" TO "claimTxHash";
ALTER TABLE "WithdrawalEvent" RENAME COLUMN "releasedAt" TO "claimedAt";
