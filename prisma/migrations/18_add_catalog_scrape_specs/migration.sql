-- CreateTable
CREATE TABLE "catalog_scrape_specs" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "articleCount" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "familyNumber" INTEGER,
    "familyText" TEXT NOT NULL,
    "subfamilyText" TEXT,
    "claseText" TEXT,
    "subClaseText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_scrape_specs_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "catalog_scrape_specs_status_idx" ON "catalog_scrape_specs"("status");
