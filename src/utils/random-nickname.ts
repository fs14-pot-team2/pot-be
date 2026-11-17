// 관형형 형용사(2~3자) + 식물 명사(2~3자) + 숫자 = 최대 7자 (닉네임 규칙 2~7자)
const ADJECTIVES = [
  "푸릇한",
  "싱그런",
  "느긋한",
  "수줍은",
  "해맑은",
  "포근한",
  "말랑한",
  "쫀득한",
  "든든한",
  "통통한",
  "엉뚱한",
  "씩씩한",
  "용감한",
  "느릿한",
  "졸린",
];
const NOUNS = [
  "새싹",
  "화분",
  "허브",
  "이끼",
  "바질",
  "잎새",
  "호야",
  "다육이",
  "선인장",
  "식집사",
  "토마토",
  "라벤더",
  "올리브",
  "제라늄",
  "방울이",
];

const MAX_LENGTH = 7;
const MAX_DIGITS = 2;

const pick = (items: string[]) => items[Math.floor(Math.random() * items.length)];

export function generateRandomNickname(): string {
  const base = `${pick(ADJECTIVES)}${pick(NOUNS)}`; // 최대 6자
  // 남는 자리만큼만 숫자를 붙여 7자를 넘지 않게 한다 (최대 2자리)
  const digitLength = Math.min(MAX_DIGITS, MAX_LENGTH - base.length);
  const digits = String(Math.floor(Math.random() * 10 ** digitLength)).padStart(digitLength, "0");
  return `${base}${digits}`;
}
