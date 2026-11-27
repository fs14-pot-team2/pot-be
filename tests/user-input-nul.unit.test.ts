import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { env } from "../src/config/env.js";
import AppError from "../src/errors/app-error.js";
import type { ErrorCode } from "../src/errors/error-definitions.js";
import { validateLogin, validateSignup } from "../src/validators/auth-validator.js";
import { validateSendMessageBody } from "../src/validators/message-validator.js";
import {
  validateDescription,
  validateProfileImageUrl,
  validateShortIntroduction,
} from "../src/validators/profile-validator.js";
import {
  validateCreateReviewBody,
  validateUpdateReviewBody,
} from "../src/validators/review-validator.js";

process.env.PROFILE_IMAGE_CLOUDFRONT_URL ??= "https://test.cloudfront.net";

const base = env.profileImageCloudfrontUrl.replace(/\/+$/, "");
const imageUrl = `${base}/profile-images/sitter/2/3f2a9c1e-7b4d-4e8a-9d21-5c6b8a0e1f34.png`;
const account = { email: "a\0b@example.com", password: "password1!", role: "OWNER" };

const cases: Array<[string, () => unknown, ErrorCode]> = [
  [
    "회원가입 이메일",
    () => validateSignup({ ...account, nickname: "초록" }),
    "INVALID_EMAIL_FORMAT",
  ],
  ["로그인 이메일", () => validateLogin(account), "INVALID_EMAIL_FORMAT"],
  ["한 줄 소개", () => validateShortIntroduction("초\0록"), "INVALID_PROFILE_INTRODUCTION"],
  ["상세 소개", () => validateDescription("초\0록"), "INVALID_PROFILE_DESCRIPTION"],
  [
    "프로필 이미지 URL",
    () => validateProfileImageUrl(`${imageUrl}\0`, { id: 2n, role: "SITTER" }),
    "INVALID_PROFILE_IMAGE",
  ],
  [
    "리뷰 작성 내용",
    () => validateCreateReviewBody({ rating: 5, content: "초\0록" }),
    "INVALID_REVIEW_CONTENT",
  ],
  [
    "리뷰 수정 내용",
    () => validateUpdateReviewBody({ content: "초\0록" }),
    "INVALID_REVIEW_CONTENT",
  ],
  [
    "쪽지 내용",
    () => validateSendMessageBody({ otherUserId: "1", content: "초\0록" }),
    "INVALID_MESSAGE_CONTENT",
  ],
];

describe("DB 입력 문자열 NUL 문자 거부", () => {
  for (const [title, run, code] of cases) {
    it(`${title}에 NUL 문자가 있으면 ${code}다`, () => {
      assert.throws(run, new AppError(code));
    });
  }
});
