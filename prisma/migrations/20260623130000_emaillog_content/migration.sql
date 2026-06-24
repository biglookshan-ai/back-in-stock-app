ALTER TABLE "EmailLog" ADD COLUMN "subject" TEXT;
ALTER TABLE "EmailLog" ADD COLUMN "htmlBody" TEXT;
CREATE INDEX "EmailLog_subscriptionId_sentAt_idx" ON "EmailLog" ("subscriptionId", "sentAt");
