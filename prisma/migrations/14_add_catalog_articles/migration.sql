-- CreateTable
CREATE TABLE "catalog_articles" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "familyText" TEXT,
    "subfamilyText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_articles_pkey" PRIMARY KEY ("id")
);
