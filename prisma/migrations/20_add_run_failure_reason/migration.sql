-- AlterTable
ALTER TABLE "runs" ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "failureDetail" TEXT;
