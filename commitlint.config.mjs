const config = {
  extends: ["@commitlint/config-conventional"],
  defaultIgnores: false,
  plugins: [
    {
      rules: {
        "team-message": ({ header }) => [
          /^(feat|fix|refactor|chore|style): (?=.*[가-힣])\S.*$/u.test(header ?? ""),
          "커밋은 feat/fix/refactor/chore/style: 한글설명 형식이어야 합니다.",
        ],
      },
    },
  ],
  rules: {
    "team-message": [2, "always"],
    "type-enum": [2, "always", ["feat", "fix", "refactor", "chore", "style"]],
    "subject-case": [0],
  },
};

export default config;
