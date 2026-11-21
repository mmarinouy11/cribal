-- AlterTable: default to "only email when relevant" for NEW companies only.
ALTER TABLE "company_configs" ALTER COLUMN "emailOnlyWhenRelevant" SET DEFAULT true;

-- AlterTable: track the daily-digest closing reminders (3-day and 1-day marks).
ALTER TABLE "opportunities" ADD COLUMN     "closeReminder3dSentAt" TIMESTAMP(3),
ADD COLUMN     "closeReminder1dSentAt" TIMESTAMP(3);
