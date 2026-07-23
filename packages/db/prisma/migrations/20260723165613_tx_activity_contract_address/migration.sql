-- AlterTable
ALTER TABLE "TxActivity" ADD COLUMN     "contractAddress" TEXT;

-- CreateIndex
CREATE INDEX "TxActivity_chainDbId_contractAddress_idx" ON "TxActivity"("chainDbId", "contractAddress");
