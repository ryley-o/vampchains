-- CreateEnum
CREATE TYPE "ChainStatus" AS ENUM ('PENDING_PROVISION', 'PROVISIONING', 'ACTIVE', 'DEACTIVATING', 'DEACTIVATED', 'PROVISION_FAILED');

-- CreateEnum
CREATE TYPE "FundingEventKind" AS ENUM ('CREATED', 'TOPUP', 'WITHDRAWAL');

-- CreateTable
CREATE TABLE "Chain" (
    "id" SERIAL NOT NULL,
    "chainId" BIGINT NOT NULL,
    "evmChainId" BIGINT NOT NULL,
    "baseToken" TEXT NOT NULL,
    "baseTokenName" TEXT NOT NULL,
    "baseTokenSymbol" TEXT NOT NULL,
    "baseTokenDecimals" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "creator" TEXT NOT NULL,
    "status" "ChainStatus" NOT NULL DEFAULT 'PENDING_PROVISION',
    "flyAppName" TEXT,
    "rpcUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepositEvent" (
    "id" SERIAL NOT NULL,
    "chainDbId" INTEGER NOT NULL,
    "chainId" BIGINT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "nonce" BIGINT NOT NULL,
    "from" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "mintedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepositEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WithdrawalEvent" (
    "id" SERIAL NOT NULL,
    "chainDbId" INTEGER NOT NULL,
    "chainId" BIGINT NOT NULL,
    "sidechainTxHash" TEXT NOT NULL,
    "sidechainBlock" BIGINT NOT NULL,
    "to" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "releaseTxHash" TEXT,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WithdrawalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingEvent" (
    "id" SERIAL NOT NULL,
    "chainDbId" INTEGER NOT NULL,
    "chainId" BIGINT NOT NULL,
    "kind" "FundingEventKind" NOT NULL,
    "amount" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexerCursor" (
    "id" TEXT NOT NULL,
    "lastBlock" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexerCursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Chain_chainId_key" ON "Chain"("chainId");

-- CreateIndex
CREATE UNIQUE INDEX "Chain_evmChainId_key" ON "Chain"("evmChainId");

-- CreateIndex
CREATE INDEX "Chain_status_idx" ON "Chain"("status");

-- CreateIndex
CREATE INDEX "Chain_baseToken_idx" ON "Chain"("baseToken");

-- CreateIndex
CREATE INDEX "DepositEvent_chainId_idx" ON "DepositEvent"("chainId");

-- CreateIndex
CREATE INDEX "DepositEvent_mintedAt_idx" ON "DepositEvent"("mintedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DepositEvent_txHash_logIndex_key" ON "DepositEvent"("txHash", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawalEvent_sidechainTxHash_key" ON "WithdrawalEvent"("sidechainTxHash");

-- CreateIndex
CREATE INDEX "WithdrawalEvent_chainId_idx" ON "WithdrawalEvent"("chainId");

-- CreateIndex
CREATE INDEX "WithdrawalEvent_releasedAt_idx" ON "WithdrawalEvent"("releasedAt");

-- CreateIndex
CREATE INDEX "FundingEvent_chainId_idx" ON "FundingEvent"("chainId");

-- CreateIndex
CREATE UNIQUE INDEX "FundingEvent_txHash_chainId_kind_key" ON "FundingEvent"("txHash", "chainId", "kind");

-- AddForeignKey
ALTER TABLE "DepositEvent" ADD CONSTRAINT "DepositEvent_chainDbId_fkey" FOREIGN KEY ("chainDbId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WithdrawalEvent" ADD CONSTRAINT "WithdrawalEvent_chainDbId_fkey" FOREIGN KEY ("chainDbId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingEvent" ADD CONSTRAINT "FundingEvent_chainDbId_fkey" FOREIGN KEY ("chainDbId") REFERENCES "Chain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
