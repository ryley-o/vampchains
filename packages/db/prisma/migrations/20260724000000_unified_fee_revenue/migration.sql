-- Unified fee-revenue accounting: one cumulative counter over tips +
-- base-fee burn, one attestation, one on-chain claim (claimFeeRevenue).
-- Replaces the old split base-fee/swept-tip design.

-- Chain: add the new unified fee-revenue columns.
ALTER TABLE "Chain" ADD COLUMN "cumulativeTipsNativeWei" TEXT NOT NULL DEFAULT '0';
ALTER TABLE "Chain" ADD COLUMN "cumulativeFeeRevenue" TEXT NOT NULL DEFAULT '0';
ALTER TABLE "Chain" ADD COLUMN "feeRevenueAsOfBlock" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Chain" ADD COLUMN "feeRevenueAttestedAt" TIMESTAMP(3);
ALTER TABLE "Chain" ADD COLUMN "feeRevenueAttestationSignature" TEXT;

-- Chain: drop the old split-design columns (cumulativeBaseFeeBurnedNativeWei
-- is KEPT — it's still the base-fee component of the unified counter).
ALTER TABLE "Chain" DROP COLUMN "cumulativeBaseFeeBurned";
ALTER TABLE "Chain" DROP COLUMN "baseFeeScanBlock";
ALTER TABLE "Chain" DROP COLUMN "baseFeeAttestedAt";
ALTER TABLE "Chain" DROP COLUMN "baseFeeAttestationSignature";
ALTER TABLE "Chain" DROP COLUMN "unclaimedSweptNativeWei";

-- Reset the retained base-fee native-wei counter so the unified walker
-- rebuilds it from genesis alongside the new tips counter, consistently
-- (the new walker excludes protocol-sent gas, which the old one did not).
UPDATE "Chain" SET "cumulativeBaseFeeBurnedNativeWei" = '0';

-- WithdrawalEvent: fee-sweeps no longer exist as a withdrawal kind. Delete
-- any old FEE_SWEEP rows (their signatures are bound to now-retired bridge
-- deployments anyway), then drop the column and enum.
DELETE FROM "WithdrawalEvent" WHERE "kind" = 'FEE_SWEEP';
ALTER TABLE "WithdrawalEvent" DROP COLUMN "kind";
DROP TYPE "WithdrawalKind";

-- Rebuild-from-genesis reset for the unified activity walker: clear the
-- per-tx history and leaderboard rows plus the gas-contribution cursors for
-- every chain, so the walker recomputes GasContribution / TxActivity / fee
-- revenue together from block 0 under the new (protocol-excluding) logic.
-- Demo chain has near-zero traffic; trivial to rebuild.
DELETE FROM "GasContribution";
DELETE FROM "TxActivity";
DELETE FROM "IndexerCursor" WHERE "id" LIKE 'gas-contribution-%';
