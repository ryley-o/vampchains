CREATE TABLE "GasContribution" (
    "id" SERIAL NOT NULL,
    "chainDbId" INTEGER NOT NULL,
    "chainId" BIGINT NOT NULL,
    "address" TEXT NOT NULL,
    "totalGasSpentNativeWei" TEXT NOT NULL DEFAULT '0',
    "lastBlock" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GasContribution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GasContribution_chainDbId_address_key" ON "GasContribution"("chainDbId", "address");

CREATE INDEX "GasContribution_chainDbId_idx" ON "GasContribution"("chainDbId");

ALTER TABLE "GasContribution" ADD CONSTRAINT "GasContribution_chainDbId_fkey" FOREIGN KEY ("chainDbId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
