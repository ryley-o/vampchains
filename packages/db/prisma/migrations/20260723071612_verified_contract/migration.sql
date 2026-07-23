CREATE TABLE "VerifiedContract" (
    "id" SERIAL NOT NULL,
    "chainDbId" INTEGER NOT NULL,
    "chainId" BIGINT NOT NULL,
    "address" TEXT NOT NULL,
    "contractName" TEXT NOT NULL,
    "compilerVersion" TEXT NOT NULL,
    "optimizerEnabled" BOOLEAN NOT NULL,
    "optimizerRuns" INTEGER,
    "viaIr" BOOLEAN NOT NULL DEFAULT false,
    "standardJsonInput" JSONB NOT NULL,
    "constructorArgs" TEXT,
    "abi" JSONB NOT NULL,
    "matchType" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerifiedContract_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VerifiedContract_chainDbId_address_key" ON "VerifiedContract"("chainDbId", "address");

CREATE INDEX "VerifiedContract_chainId_idx" ON "VerifiedContract"("chainId");

ALTER TABLE "VerifiedContract" ADD CONSTRAINT "VerifiedContract_chainDbId_fkey" FOREIGN KEY ("chainDbId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
