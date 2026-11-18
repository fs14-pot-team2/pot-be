import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import AppError from "../errors/app-error.js";

// Lambda의 내부 SSE 전파 요청 인증
export const authenticateInternalSse: RequestHandler = (request, _response, next) => {
  const providedSecret = request.header("x-internal-sse-secret");

  if (!providedSecret) {
    next(new AppError("UNAUTHORIZED"));
    return;
  }

  // SHA-256 해시 객체에 서버의 INTERNAL_SSE_SECRET 값을 입력하고, digest()로 최종 해시 결과를 반환
  const expectedHash = createHash("sha256").update(env.internalSseSecret).digest();
  // 위와 동일한 방식으로 Lambda가 요청 헤더에 전달한 비밀키의 최종 해시 결과를 반환
  const providedHash = createHash("sha256").update(providedSecret).digest();

  // timingSafeEqual(): 두 해시값을 비교할 때 값의 내용에 따른 시간 차이를 줄여 타이밍 공격을 방지
  if (!timingSafeEqual(expectedHash, providedHash)) {
    next(new AppError("UNAUTHORIZED"));
    return;
  }

  next();
};
