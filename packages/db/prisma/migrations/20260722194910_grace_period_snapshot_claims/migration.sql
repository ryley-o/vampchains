-- AlterEnum
ALTER TYPE "ChainStatus" ADD VALUE 'AWAITING_SNAPSHOT';

-- CreateTable
CREATE TABLE "SnapshotEntitlement" (
    "id" SERIAL NOT NULL,
    "chainDbId" INTEGER NOT NULL,
    "chainId" BIGINT NOT NULL,
    "token" TEXT,
    "address" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "proof" TEXT NOT NULL,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SnapshotEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SnapshotEntitlement_chainId_idx" ON "SnapshotEntitlement"("chainId");

-- CreateIndex
CREATE INDEX "SnapshotEntitlement_address_idx" ON "SnapshotEntitlement"("address");

-- CreateIndex
CREATE UNIQUE INDEX "SnapshotEntitlement_chainDbId_token_address_key" ON "SnapshotEntitlement"("chainDbId", "token", "address");

-- AddForeignKey
ALTER TABLE "SnapshotEntitlement" ADD CONSTRAINT "SnapshotEntitlement_chainDbId_fkey" FOREIGN KEY ("chainDbId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
