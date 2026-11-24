-- AlterTable: count onboarding-sample opportunities promoted to source=pipeline.
ALTER TABLE "runs" ADD COLUMN "itemsPromoted" INTEGER NOT NULL DEFAULT 0;
