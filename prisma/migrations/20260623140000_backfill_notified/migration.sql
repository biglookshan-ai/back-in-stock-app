-- 一次性回填：凡是「已成功发过通知邮件（到货/手动，非订阅确认信）」但仍停在
-- 等待中(ACTIVE)的订阅，统一改为已发送(NOTIFIED)。
-- 修正本功能上线前手动发送、状态未更新的历史数据。
UPDATE "Subscription" s
SET "status" = 'NOTIFIED',
    "notifiedAt" = COALESCE(s."notifiedAt", now())
WHERE s."status" = 'ACTIVE'
  AND EXISTS (
    SELECT 1 FROM "EmailLog" l
    WHERE l."subscriptionId" = s."id"
      AND l."status" = 'SENT'
      AND l."type" <> 'CONFIRMATION'
  );
