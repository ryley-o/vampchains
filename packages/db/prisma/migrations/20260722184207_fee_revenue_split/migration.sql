-- CreateEnum
CREATE TYPE "WithdrawalKind" AS ENUM ('USER', 'FEE_SWEEP');

-- AlterTable
ALTER TABLE "Chain" ADD COLUMN     "baseFeeAttestationSignature" TEXT,
ADD COLUMN     "baseFeeAttestedAt" TIMESTAMP(3),
ADD COLUMN     "baseFeeScanBlock" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "cumulativeBaseFeeBurned" TEXT NOT NULL DEFAULT '0';

-- AlterTable
ALTER TABLE "WithdrawalEvent" ADD COLUMN     "kind" "WithdrawalKind" NOT NULL DEFAULT 'USER';

-- RenameIndex
ALTER INDEX "WithdrawalEvent_releasedAt_idx" RENAME TO "WithdrawalEvent_claimedAt_idx";
