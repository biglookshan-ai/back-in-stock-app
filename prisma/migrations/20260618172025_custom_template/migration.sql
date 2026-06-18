-- CreateTable
CREATE TABLE "CustomTemplate" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "htmlBody" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomTemplate_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "CustomTemplate_shop_idx" ON "CustomTemplate"("shop");
