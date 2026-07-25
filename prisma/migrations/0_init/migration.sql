-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('NUEVA', 'REVISANDO', 'RELEVANTE', 'DESCARTADA', 'CONTACTADA', 'NO_FIT', 'ARCHIVADA');

-- CreateTable
CREATE TABLE "company_configs" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "description" TEXT,
    "capabilities" TEXT[],
    "relevantKeywords" TEXT[],
    "excludedKeywords" TEXT[],
    "excludedProducts" TEXT[],
    "minimumScore" INTEGER NOT NULL DEFAULT 7,
    "lookbackDays" INTEGER NOT NULL DEFAULT 1,
    "rssFeeds" TEXT[],
    "customAiPrompt" TEXT,
    "notificationEmails" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "feedsChecked" INTEGER NOT NULL DEFAULT 0,
    "rawItemsFound" INTEGER NOT NULL DEFAULT 0,
    "itemsAfterDateFilter" INTEGER NOT NULL DEFAULT 0,
    "itemsAfterKeyword" INTEGER NOT NULL DEFAULT 0,
    "itemsAfterStageGate" INTEGER NOT NULL DEFAULT 0,
    "itemsSentToAi" INTEGER NOT NULL DEFAULT 0,
    "opportunitiesSaved" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'ARCE',
    "publicationDate" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organismo" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT NOT NULL,
    "tenderType" TEXT,
    "category" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "recommendedPlay" TEXT,
    "stageGatePassed" BOOLEAN,
    "stageGateReason" TEXT,
    "aiRawOutput" JSONB,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'NUEVA',
    "owner" TEXT,
    "nextAction" TEXT,
    "nextFollowUpDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_publications" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "rawRssItem" JSONB NOT NULL,
    "normalized" JSONB,
    "filterResult" TEXT,
    "filterReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_publications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_opportunityId_key" ON "opportunities"("opportunityId");

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_publications" ADD CONSTRAINT "raw_publications_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

