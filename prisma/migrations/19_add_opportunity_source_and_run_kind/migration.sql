-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'pipeline';

-- AlterTable
ALTER TABLE "runs" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'pipeline';
