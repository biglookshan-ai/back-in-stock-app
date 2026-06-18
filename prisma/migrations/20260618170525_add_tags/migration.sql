-- Add manual tags column to Subscription
ALTER TABLE "Subscription" ADD COLUMN "tags" TEXT NOT NULL DEFAULT '';
