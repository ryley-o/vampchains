-- Add homeChainId as nullable first so we can backfill existing rows
-- (every chain created before this migration was created on Base Sepolia,
-- 84532 — the only home chain that existed until now) before making it
-- required.
ALTER TABLE "Chain" ADD COLUMN "homeChainId" INTEGER;
UPDATE "Chain" SET "homeChainId" = 84532 WHERE "homeChainId" IS NULL;
ALTER TABLE "Chain" ALTER COLUMN "homeChainId" SET NOT NULL;

-- chainId is only unique *within* a home chain now (each VampChainRegistry
-- deployment independently counts from 1) — drop the old global-unique
-- index and replace it with a compound one.
DROP INDEX "Chain_chainId_key";
CREATE UNIQUE INDEX "Chain_homeChainId_chainId_key" ON "Chain"("homeChainId", "chainId");

CREATE INDEX "Chain_homeChainId_idx" ON "Chain"("homeChainId");
