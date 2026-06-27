-- 新老客分类：老客已下单(ORDERED) / 老客未下单(NO_ORDER) / 新客(NEW) / 未分类(null)
ALTER TABLE "Subscription" ADD COLUMN "customerType" TEXT;
CREATE INDEX "Subscription_shop_customerType_idx" ON "Subscription"("shop", "customerType");
