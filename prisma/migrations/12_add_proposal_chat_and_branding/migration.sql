-- AlterTable
ALTER TABLE "company_profiles" ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "rut" TEXT,
ADD COLUMN     "isPyme" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "brandColorPrimary" TEXT DEFAULT '#0c1e3c',
ADD COLUMN     "brandColorSecondary" TEXT DEFAULT '#06b6d4';

-- CreateTable
CREATE TABLE "proposal_chats" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposal_chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_chat_messages" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "proposal_chats_opportunityId_key" ON "proposal_chats"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_chats_opportunityId_companyId_key" ON "proposal_chats"("opportunityId", "companyId");

-- AddForeignKey
ALTER TABLE "proposal_chats" ADD CONSTRAINT "proposal_chats_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_chat_messages" ADD CONSTRAINT "proposal_chat_messages_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "proposal_chats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
