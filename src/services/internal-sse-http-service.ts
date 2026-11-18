import { request } from "node:https";
import { env } from "../config/env.js";

const EB_HOSTNAME = "pot-api.duckdns.org";
const INTERNAL_SSE_PATH = "/internal/sse/notifications";
const HTTP_TIMEOUT_MS = 5000;

// Lambda에서 EB 내부 API로 알림 SSE 전파 요청
// HTTP 응답을 정상적으로 수신했는지, 네트워크 오류나 타임아웃이 발생했는지만 식별
export function sendInternalSseNotification(
  notificationId: bigint,
  recipientId: bigint,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      notificationId: notificationId.toString(),
      recipientId: recipientId.toString(),
    });

    const httpRequest = request(
      {
        hostname: env.internalSseEbPrivateIp,
        port: 443,
        path: INTERNAL_SSE_PATH,
        method: "POST",
        servername: EB_HOSTNAME,
        headers: {
          Host: EB_HOSTNAME,
          "x-internal-sse-secret": env.internalSseSecret,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: HTTP_TIMEOUT_MS,
      },
      (response) => {
        response.resume();

        response.on("end", () => {
          resolve(response.statusCode ?? 0);
        });

        response.on("error", reject);
      },
    );

    httpRequest.on("timeout", () => {
      httpRequest.destroy(new Error("Internal SSE HTTP request timed out"));
    });

    httpRequest.on("error", reject);

    httpRequest.end(body);
  });
}
