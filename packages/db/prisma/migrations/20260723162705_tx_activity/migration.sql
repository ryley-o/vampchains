-- CreateTable
CREATE TABLE "TxActivity" (
    "id" SERIAL NOT NULL,
    "chainDbId" INTEGER NOT NULL,
    "chainId" BIGINT NOT NULL,
    "txHash" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT,
    "valueNativeWei" TEXT NOT NULL,
    "methodSelector" TEXT,
    "status" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TxActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TxActivity_chainDbId_from_idx" ON "TxActivity"("chainDbId", "from");

-- CreateIndex
CREATE INDEX "TxActivity_chainDbId_to_idx" ON "TxActivity"("chainDbId", "to");

-- CreateIndex
CREATE UNIQUE INDEX "TxActivity_chainDbId_txHash_key" ON "TxActivity"("chainDbId", "txHash");

-- AddForeignKey
ALTER TABLE "TxActivity" ADD CONSTRAINT "TxActivity_chainDbId_fkey" FOREIGN KEY ("chainDbId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
