-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('QUOTE_RECEIVED', 'QUOTE_UPDATED', 'DESIGNATED_REQUEST_REJECTED', 'OWNER_CARE_STARTED', 'OWNER_CARE_ENDING', 'REVIEW_AVAILABLE', 'CARE_REQUEST_EXPIRING', 'DESIGNATED_REQUEST_RECEIVED', 'QUOTE_CONFIRMED', 'REVIEW_RECEIVED', 'CARE_REQUEST_CANCELED', 'CARE_REQUEST_EXPIRED', 'SITTER_CARE_STARTED', 'SITTER_CARE_ENDING');

-- CreateTable
CREATE TABLE "Notification" (
    "id" BIGSERIAL NOT NULL,
    "recipientId" BIGINT NOT NULL,
    "careRequestId" BIGINT NOT NULL,
    "quoteId" BIGINT,
    "designatedRequestId" BIGINT,
    "reviewId" BIGINT,
    "type" "NotificationType" NOT NULL,
    "message" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_recipientId_createdAt_id_idx" ON "Notification"("recipientId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Notification_recipientId_readAt_idx" ON "Notification"("recipientId", "readAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_careRequestId_fkey" FOREIGN KEY ("careRequestId") REFERENCES "CareRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_designatedRequestId_fkey" FOREIGN KEY ("designatedRequestId") REFERENCES "DesignatedRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- 견적 기반 단발성 알림
CREATE UNIQUE INDEX "Notification_unique_quote_event_idx"
ON "Notification" ("recipientId", "type", "quoteId")
WHERE "type" IN ('QUOTE_RECEIVED', 'QUOTE_CONFIRMED');

-- 지정 요청 기반 단발성 알림
CREATE UNIQUE INDEX "Notification_unique_designated_event_idx"
ON "Notification" ("recipientId", "type", "designatedRequestId")
WHERE "type" IN (
  'DESIGNATED_REQUEST_RECEIVED',
  'DESIGNATED_REQUEST_REJECTED'
);

-- 리뷰 기반 단발성 알림
CREATE UNIQUE INDEX "Notification_unique_review_event_idx"
ON "Notification" ("recipientId", "type", "reviewId")
WHERE "type" = 'REVIEW_RECEIVED';

-- 돌봄 요청 기반 단발성 알림
CREATE UNIQUE INDEX "Notification_unique_care_request_event_idx"
ON "Notification" ("recipientId", "type", "careRequestId")
WHERE "type" IN (
  'OWNER_CARE_STARTED',
  'OWNER_CARE_ENDING',
  'REVIEW_AVAILABLE',
  'CARE_REQUEST_EXPIRING',
  'CARE_REQUEST_CANCELED',
  'CARE_REQUEST_EXPIRED',
  'SITTER_CARE_STARTED',
  'SITTER_CARE_ENDING'
);
