import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { env } from "../config/env.js";
import AppError from "../errors/app-error.js";
import { isUserRole, type AuthUser, type UserRole } from "../types/auth.js";
import { parseBigId } from "../utils/bigint.js";

function parseAuthUser(payload: jwt.JwtPayload): AuthUser | null {
  const { sub, role } = payload;
  const id = parseBigId(sub);
  if (id === null || !isUserRole(role)) {
    return null;
  }
  return { id, role };
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(new AppError("UNAUTHORIZED"));
  }

  const token = header.slice("Bearer ".length).trim();

  try {
    const decoded = jwt.verify(token, env.jwtAccessSecret, {
      algorithms: ["HS256"],
    });

    const user = typeof decoded === "string" ? null : parseAuthUser(decoded);
    if (!user) {
      return next(new AppError("UNAUTHORIZED"));
    }

    req.user = user;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return next(new AppError("TOKEN_EXPIRED"));
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return next(new AppError("UNAUTHORIZED"));
    }
    return next(error);
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
