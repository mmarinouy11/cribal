-- CreateEnum
CREATE TYPE "FailureType" AS ENUM ('DESIERTA', 'OFERTAS_RECHAZADAS');

-- CreateEnum
CREATE TYPE "NicheCategory" AS ENUM ('NUCLEO', 'ADYACENTE', 'FUERA');

-- CreateEnum
CREATE TYPE "SignalStrength" AS ENUM ('ALTA', 'MEDIA', 'BAJA');

-- CreateEnum
CREATE TYPE "NicheStatus" AS ENUM ('NUEVO', 'EXPLORANDO', 'DESCARTADO', 'ARCHIVADO');

-- AlterTable
ALTER TABLE "runs" ADD COLUMN     "failedTendersFound" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "nichesDetected" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "failed_tenders" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "failureId" TEXT NOT NULL,
    "failureType" "FailureType" NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "organismo" TEXT,
    "publicationDate" TIMESTAMP(3),
    "articleCodes" TEXT[],
    "tenderItems" JSONB,
    "nicheCategory" "NicheCategory" NOT NULL DEFAULT 'FUERA',
    "fitScore" INTEGER NOT NULL DEFAULT 0,
    "fitReason" TEXT,
    "missingCapability" TEXT,
    "nicheId" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "failed_tenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "niches" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "organismo" TEXT NOT NULL,
    "articleCode" TEXT,
    "label" TEXT NOT NULL,
    "category" "NicheCategory" NOT NULL DEFAULT 'FUERA',
    "fitScore" INTEGER NOT NULL DEFAULT 0,
    "missingCapability" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "desiertaCount" INTEGER NOT NULL DEFAULT 0,
    "rechazadaCount" INTEGER NOT NULL DEFAULT 0,
    "firstFailureAt" TIMESTAMP(3) NOT NULL,
    "lastFailureAt" TIMESTAMP(3) NOT NULL,
    "signalStrength" "SignalStrength" NOT NULL DEFAULT 'BAJA',
    "aiAnalysis" TEXT,
    "analyzedAt" TIMESTAMP(3),
    "status" "NicheStatus" NOT NULL DEFAULT 'NUEVO',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "niches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "failed_tenders_companyId_failureId_key" ON "failed_tenders"("companyId", "failureId");

-- CreateIndex
CREATE UNIQUE INDEX "niches_companyId_organismo_articleCode_key" ON "niches"("companyId", "organismo", "articleCode");

-- AddForeignKey
ALTER TABLE "failed_tenders" ADD CONSTRAINT "failed_tenders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "failed_tenders" ADD CONSTRAINT "failed_tenders_nicheId_fkey" FOREIGN KEY ("nicheId") REFERENCES "niches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "niches" ADD CONSTRAINT "niches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
