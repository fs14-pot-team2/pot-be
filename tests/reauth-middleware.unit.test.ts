import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { env } from "../src/config/env.js";
import AppError from "../src/errors/app-error.js";
import { requireReauth } from "../src/middlewares/auth-middleware.js";
import {
  REAUTH_TOKEN_EXPIRES_IN_SECONDS,
  REAUTH_TOKEN_MAX_AGE_MS,
  signAccessToken,
  signReauthToken,
  verifyReauthToken,
} from "../src/utils/jwt.js";

const USER_ID = 100n;

// requireReauth가 사용하는 req 필드(user, cookies)만 흉내 낸 요청
function createRequest(options: { userId?: bigint; token?: string }) {
  return {
    user: options.userId === undefined ? undefined : { id: options.userId, role: "OWNER" },
    cookies: options.token === undefined ? {} : { reauthToken: options.token },
  } as unknown as Request;
}

// next에 전달된 인자를 그대로 받아 오는 헬퍼
function runMiddleware(req: Request) {
  let received: unknown = "next가 호출되지 않음";
  const next: NextFunction = (error?: unknown) => {
    received = error;
  };

  requireReauth(req, {} as Response, next);
  return received;
}

function assertReauthRequired(received: unknown) {
  assert.ok(received instanceof AppError);
  assert.equal(received.code, "REAUTHENTICATION_REQUIRED");
  assert.equal(received.statusCode, 403);
}

describe("재인증 토큰 검증 미들웨어", () => {
  it("올바른 재인증 쿠키면 에러 없이 next를 호출한다", () => {
    const token = signReauthToken(USER_ID.toString());

    assert.equal(runMiddleware(createRequest({ userId: USER_ID, token })), undefined);
  });

  it("쿠키가 없으면 REAUTHENTICATION_REQUIRED(403)를 반환한다", () => {
    assertReauthRequired(runMiddleware(createRequest({ userId: USER_ID })));
  });

  it("다른 사용자의 재인증 쿠키면 REAUTHENTICATION_REQUIRED를 반환한다", () => {
    const token = signReauthToken("999");

    assertReauthRequired(runMiddleware(createRequest({ userId: USER_ID, token })));
  });

  it("만료된 재인증 쿠키면 REAUTHENTICATION_REQUIRED를 반환한다", () => {
    const token = jwt.sign(
      { sub: USER_ID.toString(), purpose: "profile-update" },
      env.jwtReauthSecret,
      { algorithm: "HS256", expiresIn: -10 },
    );

    assertReauthRequired(runMiddleware(createRequest({ userId: USER_ID, token })));
  });

  it("다른 시크릿으로 서명한 토큰이면 REAUTHENTICATION_REQUIRED를 반환한다", () => {
    const token = jwt.sign(
      { sub: USER_ID.toString(), purpose: "profile-update" },
      `${env.jwtReauthSecret}-forged`,
      { algorithm: "HS256", expiresIn: "3m" },
    );

    assertReauthRequired(runMiddleware(createRequest({ userId: USER_ID, token })));
  });

  it("purpose가 다른 토큰이면 REAUTHENTICATION_REQUIRED를 반환한다", () => {
    const token = jwt.sign({ sub: USER_ID.toString(), purpose: "other" }, env.jwtReauthSecret, {
      algorithm: "HS256",
      expiresIn: "3m",
    });

    assertReauthRequired(runMiddleware(createRequest({ userId: USER_ID, token })));
  });

  it("Access Token을 재인증 쿠키로 넣으면 REAUTHENTICATION_REQUIRED를 반환한다", () => {
    const token = signAccessToken({ sub: USER_ID.toString(), role: "OWNER" });

    assertReauthRequired(runMiddleware(createRequest({ userId: USER_ID, token })));
  });

  it("인증 정보(req.user)가 없으면 UNAUTHORIZED(401)를 반환한다", () => {
    const received = runMiddleware(createRequest({ token: signReauthToken("100") }));

    assert.ok(received instanceof AppError);
    assert.equal(received.code, "UNAUTHORIZED");
    assert.equal(received.statusCode, 401);
  });
});

describe("재인증 토큰 유틸", () => {
  it("발급한 토큰을 검증하면 userId를 반환한다", () => {
    assert.equal(verifyReauthToken(signReauthToken("42")), "42");
  });

  it("형식이 잘못된 토큰이면 null을 반환한다", () => {
    assert.equal(verifyReauthToken("not-a-jwt"), null);
  });

  it("sub가 BigInt로 변환되지 않으면 null을 반환한다", () => {
    const token = jwt.sign({ sub: "abc", purpose: "profile-update" }, env.jwtReauthSecret, {
      algorithm: "HS256",
      expiresIn: "3m",
    });

    assert.equal(verifyReauthToken(token), null);
  });

  it("재인증 토큰은 3분 뒤 만료되고 쿠키 maxAge와 일치한다", () => {
    const decoded = jwt.decode(signReauthToken("42")) as { iat: number; exp: number };

    assert.equal(decoded.exp - decoded.iat, REAUTH_TOKEN_EXPIRES_IN_SECONDS);
    assert.equal(REAUTH_TOKEN_MAX_AGE_MS, REAUTH_TOKEN_EXPIRES_IN_SECONDS * 1000);
  });
});
