import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateRandomNickname } from "../src/utils/random-nickname.js";
import { validateUpdateMe } from "../src/validators/user-validator.js";

const SAMPLE_COUNT = 10_000;

describe("랜덤 닉네임 생성", () => {
  it("생성된 닉네임은 닉네임 검증 규칙을 모두 통과한다", () => {
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const nickname = generateRandomNickname();

      assert.doesNotThrow(() => validateUpdateMe({ nickname }), `검증 실패 닉네임: ${nickname}`);
    }
  });

  it("2~7자의 한글·숫자 조합으로만 생성된다", () => {
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const nickname = generateRandomNickname();

      assert.match(nickname, /^[가-힣0-9]{2,7}$/, `형식 위반 닉네임: ${nickname}`);
    }
  });

  it("끝에 숫자가 1~2자리 붙는다", () => {
    for (let i = 0; i < 1_000; i++) {
      const nickname = generateRandomNickname();

      assert.match(nickname, /[가-힣]\d{1,2}$/, `숫자 접미사 위반 닉네임: ${nickname}`);
    }
  });

  it("호출마다 서로 다른 닉네임이 생성된다", () => {
    const nicknames = new Set<string>();
    for (let i = 0; i < 1_000; i++) {
      nicknames.add(generateRandomNickname());
    }

    // 조합 수가 수천 가지 이상이라 1,000번 중 상당수는 달라야 한다 (고정값 반환 방지)
    assert.ok(nicknames.size > 500, `고유 닉네임 수: ${nicknames.size}`);
  });
});
