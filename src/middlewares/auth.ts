import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { env } from "../config/env.js";
import { isUserRole, type AuthUser, type UserRole } from "../types/auth.js";

const unauthorized = (res: Response, message = "인증이 필요합니다.") =>
  res.status(401).json({ message });

function parseAuthUser(payload: jwt.JwtPayload): AuthUser | null {
  const { sub, role } = payload;
  if (typeof sub !== "string" || !/^\d+$/.test(sub) || !isUserRole(role)) {
    return null;
  }

  try {
    return { id: BigInt(sub), role };
  } catch {
    return null;
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return unauthorized(res);
  }

  const token = header.slice("Bearer ".length).trim();

  try {
    const decoded = jwt.verify(token, env.jwtAccessSecret, {
      algorithms: ["HS256"],
    });

    if (typeof decoded === "string") {
      return unauthorized(res, "유효하지 않은 토큰입니다.");
    }

    const user = parseAuthUser(decoded);
    if (!user) {
      return unauthorized(res, "유효하지 않은 토큰입니다.");
    }

    req.user = user;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return unauthorized(res, "토큰이 만료되었습니다.");
    }
    return unauthorized(res, "유효하지 않은 토큰입니다.");
  }
}

export function authorize(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return unauthorized(res);
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "접근 권한이 없습니다." });
    }
    next();
  };
}
