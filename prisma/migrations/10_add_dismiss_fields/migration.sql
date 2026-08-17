-- AlterEnum
ALTER TYPE "OpportunityStatus" ADD VALUE 'OFERTADA';

-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN     "dismissReason" TEXT,
ADD COLUMN     "dismissComment" TEXT,
ADD COLUMN     "dismissedAt" TIMESTAMP(3);
