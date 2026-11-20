import type { NextFunction, Request, RequestHandler, Response } from "express";

import { authenticate } from "./auth-middleware.js";
import type { AuthenticatedRequest } from "../types/authenticated-request.js";

type AuthenticatedController = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;

/*
  - 계층별 책임을 명확히 분리하여 인증 검증은 미들웨어에서만 수행
   - Controller에서는 검증된 사용자 정보를 중복 검증 없이 사용
   - 인증 필수 요청의 사용자 정보는 타입 시스템에서도 보장
*/
export function withAuthentication(
  controller: AuthenticatedController,
  ...middlewares: RequestHandler[]
): RequestHandler[] {
  const handler: RequestHandler = (req, res, next) =>
    controller(req as AuthenticatedRequest, res, next);

  return [authenticate, ...middlewares, handler];
}
