-- Shared daily ingestion (company-independent). All tables are ADDITIVE: no
-- existing table is dropped or altered, so the current per-company pipeline
-- keeps working unchanged while the new tables are populated and read.

-- CreateTable: conditional-request cache for RSS feeds (shared across companies).
CREATE TABLE "feed_cache" (
    "url" TEXT NOT NULL,
    "etag" TEXT,
    "lastModified" TEXT,
    "lastFetchedAt" TIMESTAMP(3),
    "lastStatus" INTEGER,
    "itemsJson" JSONB,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feed_cache_pkey" PRIMARY KEY ("url")
);

-- CreateTable: per-tender data that does not depend on the company.
CREATE TABLE "global_tenders" (
    "tenderId" TEXT NOT NULL,
    "familia" TEXT,
    "title" TEXT,
    "rssContent" TEXT,
    "publicationDate" TIMESTAMP(3),
    "objectDescription" TEXT,
    "tenderItems" JSONB,
    "articleCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pliegoRefs" JSONB,
    "detailHtml" TEXT,
    "detailFetchedAt" TIMESTAMP(3),
    "htmlFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "global_tenders_pkey" PRIMARY KEY ("tenderId")
);

-- CreateTable: read-through cache for company-independent AI work.
CREATE TABLE "ai_analysis_cache" (
    "contentHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "resultJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_analysis_cache_pkey" PRIMARY KEY ("contentHash")
);

-- CreateTable: global run state for the shared ingestion step.
CREATE TABLE "global_ingestion_runs" (
    "id" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "feedsTotal" INTEGER NOT NULL DEFAULT 0,
    "feedsFailed" INTEGER NOT NULL DEFAULT 0,
    "feedsFromCache" INTEGER NOT NULL DEFAULT 0,
    "tendersEnriched" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "global_ingestion_runs_pkey" PRIMARY KEY ("id")
);
