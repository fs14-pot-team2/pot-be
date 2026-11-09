import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { env } from "../config/env.js";
import AppError from "../errors/app-error.js";
import { isUserRole, type AuthUser, type UserRole } from "../types/auth.js";
import { parseBigId } from "../utils/bigint.js";
import { getReauthTokenFromCookie } from "../utils/auth-cookie.js";
import { verifyReauthToken } from "../utils/jwt.js";

function parseAuthUser(payload: jwt.JwtPayload): AuthUser | null {
  const { sub, role } = payload;
  const id = parseBigId(sub);
  if (id === null || !isUserRole(role)) {
    return null;
  }
  return { id, role };
}

function verifyAccessToken(token: string): AuthUser {
  try {
    const decoded = jwt.verify(token, env.jwtAccessSecret, {
      algorithms: ["HS256"],
    });

    const user = typeof decoded === "string" ? null : parseAuthUser(decoded);
    if (!user) {
      throw new AppError("UNAUTHORIZED");
    }
    return user;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError("TOKEN_EXPIRED");
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new AppError("UNAUTHORIZED");
    }
    throw error;
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(new AppError("UNAUTHORIZED"));
  }

  const token = header.slice("Bearer ".length).trim();

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch (error) {
    next(error);
  }
}

export function optionalAuthenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header) {
    return next();
  }
  if (!header.startsWith("Bearer ")) {
    return next(new AppError("UNAUTHORIZED"));
  }

  try {
    req.user = verifyAccessToken(header.slice("Bearer ".length).trim());
    next();
  } catch (error) {
    next(error);
  }
}

export function authorize(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError("UNAUTHORIZED"));
    }
    if (!roles.includes(req.user.role)) {
      return next(new AppError("FORBIDDEN"));
    }
    next();
  };
}

// 개인정보 수정 전 비밀번호 재인증 쿠키 검증 (authenticate 뒤에 사용)
export function requireReauth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    return next(new AppError("UNAUTHORIZED"));
  }

  try {
    const token = getReauthTokenFromCookie(req);
    const userId = token ? verifyReauthToken(token) : null;

    if (userId === null || userId !== req.user.id.toString()) {
      return next(new AppError("REAUTHENTICATION_REQUIRED"));
    }
    next();
  } catch (error) {
    next(error);
  }
}
