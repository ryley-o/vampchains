/*
  Warnings:

  - Made the column `token` on table `SnapshotEntitlement` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "SnapshotEntitlement" ALTER COLUMN "token" SET NOT NULL;
