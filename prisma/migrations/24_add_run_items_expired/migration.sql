-- AlterTable: count first-run tenders dropped as already closed/awarded (not sent to AI).
ALTER TABLE "runs" ADD COLUMN "itemsExpired" INTEGER NOT NULL DEFAULT 0;
