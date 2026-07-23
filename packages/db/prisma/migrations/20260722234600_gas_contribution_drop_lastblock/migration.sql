-- Scan progress belongs on the existing per-chain IndexerCursor table, not
-- as a per-address column here — this table is purely the aggregated
-- leaderboard total.
ALTER TABLE "GasContribution" DROP COLUMN "lastBlock";
