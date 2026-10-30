-- 동일 OWNER가 OPEN 상태의 돌봄 요청을 최대 1건만 보유하도록 제한
-- MATCHED, CANCELED, EXPIRED 상태는 제한 대상에서 제외
CREATE UNIQUE INDEX "CareRequest_one_open_per_owner_idx"
ON "CareRequest" ("ownerId")
WHERE "status" = 'OPEN';