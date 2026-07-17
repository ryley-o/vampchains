-- General ERC20 bridging: track which L1 token (if any) a deposit/withdrawal
-- is for, and index which wrapped tokens exist on each vampchain.
ALTER TABLE "DepositEvent" ADD COLUMN "token" TEXT;
ALTER TABLE "WithdrawalEvent" ADD COLUMN "token" TEXT;

CREATE TABLE "WrappedToken" (
    "id" SERIAL NOT NULL,
    "chainDbId" INTEGER NOT NULL,
    "chainId" BIGINT NOT NULL,
    "l1Token" TEXT NOT NULL,
    "wrapped" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WrappedToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WrappedToken_chainDbId_l1Token_key" ON "WrappedToken"("chainDbId", "l1Token");
CREATE INDEX "WrappedToken_chainId_idx" ON "WrappedToken"("chainId");

ALTER TABLE "WrappedToken" ADD CONSTRAINT "WrappedToken_chainDbId_fkey" FOREIGN KEY ("chainDbId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
