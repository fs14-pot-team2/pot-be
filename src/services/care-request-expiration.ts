import { prisma } from "../config/prisma.js";
import { CareRequestStatus, NotificationType } from "../generated/prisma/enums.js";
import {
  expireAllPastCareRequests,
  expireCareRequest,
  findExpiredCareRequestsForNotification,
} from "../repositories/care-request-repository.js";
import { insertNotifications } from "../repositories/notification-repository.js";
import type { DbClient, TransactionRunner } from "../types/db.js";
import { getTodayInKst } from "../utils/kst-date.js";
import { createNotificationMessage } from "../utils/notification-message.js";
import { serializeDate } from "../utils/serialize-date.js";

interface CareRequestForExpiration {
  id: bigint;
  status: CareRequestStatus;
  startDate: Date;
}

// 전달받은 돌봄 요청이 만료 대상인지, 판단하고 만료 대상일 때만 상태를 변경
// 다른 기능의 실행 여부까지 판단하지 않음
export async function expireCareRequestIfPast(
  careRequest: CareRequestForExpiration,
  db: DbClient = prisma,
): Promise<boolean> {
  if (careRequest.status !== CareRequestStatus.OPEN) {
    return false;
  }

  const startDate = serializeDate(careRequest.startDate);

  if (startDate >= getTodayInKst()) {
    return false;
  }

  await expireCareRequest(careRequest.id, db);

  return true;
}

// 시작일이 지난 모든 활성 돌봄 요청을 만료 처리하고 견적 제출 팟트너에게 알림 생성
export async function expirePastCareRequests(
  runTransaction: TransactionRunner = (callback) => prisma.$transaction(callback),
) {
  const today = getTodayInKst();
  const todayInKst = new Date(`${today}T00:00:00.000Z`);

  // 만료 예정일 포함 4일간 알림 생성 허용 정책에 따라 조회 가능한 가장 이른 시작일 계산
  const earliestEligibleStartDate = new Date(todayInKst);
  earliestEligibleStartDate.setUTCDate(earliestEligibleStartDate.getUTCDate() - 4);

  return runTransaction(async (tx) => {
    const expiredCareRequests = await expireAllPastCareRequests(todayInKst, tx);

    const careRequests = await findExpiredCareRequestsForNotification(
      earliestEligibleStartDate,
      todayInKst,
      tx,
    );

    const notifications: {
      id: bigint;
      recipientId: bigint;
      careRequestId: bigint;
    }[] = [];

    for (const careRequest of careRequests) {
      const createdNotifications = await insertNotifications(
        careRequest.quotes.map(({ sitterId }) => ({
          recipientId: sitterId,
          careRequestId: careRequest.id,
          type: NotificationType.CARE_REQUEST_EXPIRED,
          message: createNotificationMessage({
            type: NotificationType.CARE_REQUEST_EXPIRED,
            nickname: careRequest.owner.nickname,
          }),
        })),
        tx,
        { skipDuplicates: true },
      );

      notifications.push(
        ...createdNotifications.map((notification) => ({
          ...notification,
          careRequestId: careRequest.id,
        })),
      );
    }

    return {
      expiredCareRequestCount: expiredCareRequests.length,
      careRequestExpiredNotificationCount: notifications.length,
      notifications,
    };
  });
}
