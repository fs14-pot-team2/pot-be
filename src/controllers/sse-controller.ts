import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import AppError from "../errors/app-error.js";
import { addSseClient, removeSseClient } from "../services/sse-service.js";

// 로드밸런서·nginx의 유휴 연결 종료(기본 60초)보다 짧게 유지한다.
const HEARTBEAT_INTERVAL_MS = 25_000;
const RECONNECT_DELAY_MS = 3_000;

// authenticate가 이미 검증한 액세스 토큰의 만료 시각까지 남은 시간(ms)
function getMsUntilTokenExpiry(request: Request): number | null {
  const token = request.headers.authorization?.slice("Bearer ".length).trim();
  const decoded = token ? jwt.decode(token) : null;

  if (decoded === null || typeof decoded === "string" || typeof decoded.exp !== "number") {
    return null;
  }
  return Math.max(decoded.exp * 1000 - Date.now(), 0);
}

// 실시간 이벤트 수신 연결 (SSE)
export function connectEventsController(request: Request, response: Response, next: NextFunction) {
  const user = request.user;
  if (!user) {
    return next(new AppError("UNAUTHORIZED"));
  }

  response.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // nginx가 응답을 모아서 보내지 않도록 버퍼링을 끈다.
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders();
  response.write(`retry: ${RECONNECT_DELAY_MS}\n\n`);
  response.write(": connected\n\n");

  addSseClient(user.id, response);

  let cleaned = false;

  // 여러 경로(close, error, 만료, heartbeat 실패)에서 불려도 한 번만 실행
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(heartbeat);
    clearTimeout(expiryTimer);
    removeSseClient(user.id, response);
  };

  const heartbeat = setInterval(() => {
    if (response.writableEnded || response.destroyed) return cleanup();
    try {
      response.write(": ping\n\n");
    } catch (error) {
      // 인터벌 콜백에서 예외가 나면 프로세스까지 올라가므로 여기서 막는다.
      console.error("SSE heartbeat 전송에 실패했습니다.", error);
      cleanup();
    }
  }, HEARTBEAT_INTERVAL_MS);

  // 액세스 토큰이 만료되면 연결을 닫아, 프론트가 토큰을 갱신한 뒤 다시 연결하게 한다.
  const msUntilExpiry = getMsUntilTokenExpiry(request);
  const expiryTimer =
    msUntilExpiry === null
      ? undefined
      : setTimeout(() => {
          cleanup();
          response.end();
        }, msUntilExpiry);

  request.on("close", cleanup);
  response.on("close", cleanup);
  response.on("error", cleanup);
}
