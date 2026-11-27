import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Response } from "express";

import { env } from "../src/config/env.js";
import {
  clearReauthCookie,
  clearRefreshTokenCookie,
  setReauthCookie,
  setRefreshTokenCookie,
} from "../src/utils/auth-cookie.js";

const captureOptions = (run: (res: Response) => void) => {
  let options: Record<string, unknown> | undefined;
  const res = {
    cookie: (_name: string, _value: string, value: Record<string, unknown>) => {
      options = value;
    },
    clearCookie: (_name: string, value: Record<string, unknown>) => {
      options = value;
    },
  } as unknown as Response;

  run(res);
  assert.ok(options);
  return options;
};

describe("인증 쿠키 옵션", () => {
  const originalCookieSecure = env.cookieSecure;

  afterEach(() => {
    env.cookieSecure = originalCookieSecure;
  });

  const cases: [string, (res: Response) => void][] = [
    ["Refresh Token 발급", (res) => setRefreshTokenCookie(res, "token")],
    ["Refresh Token 삭제", clearRefreshTokenCookie],
    ["재인증 토큰 발급", (res) => setReauthCookie(res, "token")],
    ["재인증 토큰 삭제", clearReauthCookie],
  ];

  for (const [name, run] of cases) {
    it(`${name}에 cookieSecure 설정을 적용한다`, () => {
      for (const secure of [true, false]) {
        env.cookieSecure = secure;
        const options = captureOptions(run);

        assert.equal(options.secure, secure);
        assert.equal(options.httpOnly, true);
        assert.equal(options.sameSite, "lax");
      }
    });
  }
});
