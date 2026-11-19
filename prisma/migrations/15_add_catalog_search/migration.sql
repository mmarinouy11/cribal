-- AlterTable
ALTER TABLE "catalog_articles" ADD COLUMN     "nameNorm" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "company_configs" ADD COLUMN     "catalogArticleIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- CreateIndex
CREATE INDEX "catalog_articles_nameNorm_idx" ON "catalog_articles"("nameNorm");
