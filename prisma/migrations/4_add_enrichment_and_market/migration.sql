-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN     "clarificationsDate" TIMESTAMP(3),
ADD COLUMN     "closingDate" TIMESTAMP(3),
ADD COLUMN     "competitorMap" JSONB,
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "enrichedAt" TIMESTAMP(3),
ADD COLUMN     "isElectronic" BOOLEAN,
ADD COLUMN     "marketAnalyzedAt" TIMESTAMP(3),
ADD COLUMN     "marketSummary" TEXT,
ADD COLUMN     "openingDate" TIMESTAMP(3),
ADD COLUMN     "pliegoUrl" TEXT,
ADD COLUMN     "priceIntelligence" JSONB,
ADD COLUMN     "prorrogasDate" TIMESTAMP(3),
ADD COLUMN     "similarAdjudications" JSONB,
ADD COLUMN     "tenderItems" JSONB,
ADD COLUMN     "urgencyAlertSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "market_analyses" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "searchKeywords" TEXT[],
    "articleCodes" TEXT[],
    "adjudicationsFound" INTEGER NOT NULL DEFAULT 0,
    "competitorsFound" INTEGER NOT NULL DEFAULT 0,
    "adjudications" JSONB NOT NULL,
    "competitors" JSONB NOT NULL,
    "priceRange" JSONB NOT NULL,
    "summary" TEXT,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_analyses_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "market_analyses" ADD CONSTRAINT "market_analyses_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

