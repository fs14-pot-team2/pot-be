# POT Backend

POT (Plant On Trust) — 방문형 식물 돌봄 매칭 서비스

## 개발 환경

- Node.js **24.16.0**, npm **11.x** (기준 11.13.0)
- `nvm use`로 버전을 맞춘 후 `npm ci`를 실행합니다.
- `.env.example`을 `.env`로 복사하고 필요한 값을 설정합니다.
- `npm run dev`로 개발 서버를 실행합니다.

BE: http://localhost:4000/health

## 코드 규칙

- 들여쓰기 2칸, 큰따옴표, 세미콜론을 사용합니다.
- 변수·함수·매개변수는 `camelCase`, 타입·클래스·React 컴포넌트는 `PascalCase`입니다.
- 의미가 고정된 공용 상수는 `SCREAMING_SNAKE_CASE`입니다. 일반 `const` 지역 변수는 `camelCase`입니다.
- 커밋은 `feat/fix/refactor/chore/style: 한글설명` 형식입니다. 예: `chore: 초기 개발 환경 설정`
- `npm ci` 실행 시 Husky가 설치됩니다. 커밋 전에 변경 파일을 ESLint/Prettier로 검사하고 커밋 메시지도 검사합니다.

## 검사 명령

```bash
npm run lint
npm run format:check
npm run typecheck
npm run build
```

`npm run format`은 전체 파일을 포맷하고, `npm run lint:fix`는 수정 가능한 린트 오류를 고칩니다.
CI는 main/develop 대상 PR 및 해당 브랜치 push에서 실행됩니다. PR 커밋과 squash용 PR 제목도 검사합니다.
필수 검사 등록 시 CI의 `quality` 작업을 선택합니다.

## Prisma

Prisma 7 안정 버전을 사용합니다. `npm run prisma:validate`는 DB 접속 없이 스키마를 검사합니다.
DB 종류가 정해지지 않아 PostgreSQL datasource만 준비했으며, 모델·마이그레이션·실제 연결은 추가하지 않았습니다.
`DATABASE_URL`은 `.env`에 설정하고, 모델을 작성한 뒤 `npm run prisma:generate`를 실행하세요.
실제 DB 연결 시 선택한 DB에 맞는 Prisma driver adapter를 추가해야 합니다.
