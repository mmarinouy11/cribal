-- AlterEnum
ALTER TYPE "RunStatus" ADD VALUE 'PARTIAL';

-- CreateTable
CREATE TABLE "admin_alert_logs" (
    "id" TEXT NOT NULL,
    "alertDate" TEXT NOT NULL,
    "companiesAffected" INTEGER NOT NULL,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_alert_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_alert_logs_alertDate_key" ON "admin_alert_logs"("alertDate");
