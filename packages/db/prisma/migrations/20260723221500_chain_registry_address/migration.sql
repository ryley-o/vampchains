-- Registry redeploys restart VampChainRegistry's chainId counter from 1 on
-- the same home chain, so chainId alone (even paired with homeChainId) is
-- not enough to keep rows from different registry deployments distinct.
-- Add registryAddress and fold it into the compound unique key.

-- AlterTable
ALTER TABLE "Chain" ADD COLUMN "registryAddress" TEXT;

-- Backfill: every existing row predates this migration, so it was created
-- under the (now-old, in this one row's case now-dead) Base Sepolia
-- registry deployed before today's redeploy.
UPDATE "Chain" SET "registryAddress" = '0xcc90359855315acaf26614e918458b687c47c769' WHERE "homeChainId" = 84532 AND "registryAddress" IS NULL;
UPDATE "Chain" SET "registryAddress" = '0xb64890b48136e1953eee2cec586d03ed3f3cafb2' WHERE "homeChainId" = 11155111 AND "registryAddress" IS NULL;

ALTER TABLE "Chain" ALTER COLUMN "registryAddress" SET NOT NULL;

-- DropIndex
DROP INDEX "Chain_homeChainId_chainId_key";

-- CreateIndex
CREATE UNIQUE INDEX "Chain_homeChainId_registryAddress_chainId_key" ON "Chain"("homeChainId", "registryAddress", "chainId");
