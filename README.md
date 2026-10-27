# POT Backend

POT (Plant On Trust) — 방문형 식물 돌봄 매칭 서비스

## 개발 환경

- Node.js **24.16.0**, npm **11.x** (기준 11.13.0)
- `nvm use`로 버전을 맞춘 후 `npm ci`를 실행합니다.
- `.env.example`을 `.env`로 복사하고 필요한 값을 설정합니다.
- `npm run dev`로 개발 서버를 실행합니다.

BE: http://localhost:4000/health

## HTTPS 배포 준비

단일 인스턴스 Elastic Beanstalk의 nginx가 `pot-api.duckdns.org`에서 HTTPS를 처리합니다. 배포 설정은 인스턴스의 공인 IP를 DuckDNS에 등록하고, Let's Encrypt 인증서를 발급한 뒤 443 포트를 엽니다. 인증서와 DuckDNS 주소는 하루 두 번 확인·갱신합니다.

1. [DuckDNS](https://www.duckdns.org/)에 로그인해 `pot-api` 도메인을 등록합니다. 이미 사용 중인 이름이면 이 저장소의 HTTPS 설정에 있는 도메인도 함께 바꿔야 합니다.
2. Elastic Beanstalk 환경 속성에 `DUCKDNS_TOKEN`(DuckDNS 계정의 토큰)과 `ACME_EMAIL`(인증서 만료 알림을 받을 이메일)을 추가합니다. 토큰은 Git, PR, 채팅에 적지 않습니다.
3. HTTPS 설정이 `main`에 반영되면 배포가 인증서를 발급하고 nginx를 시작합니다. 배포 완료 후 `https://pot-api.duckdns.org/health`에서 `{"status":"ok"}`를 확인합니다.

도메인을 등록하고 두 환경 속성을 입력하기 전에는 이 변경을 `main`에 배포하지 마세요. 인증서 발급이 실패하면 배포가 중단됩니다. Elastic Beanstalk 기존 주소의 HTTP `/health`는 상태 확인용으로 유지됩니다. 인스턴스가 바뀌어 공인 IP가 달라져도 배포 또는 정기 갱신 시 DuckDNS 주소를 다시 맞춥니다.

## CORS 설정

브라우저에서 API를 호출할 프론트 주소는 Elastic Beanstalk 환경 속성 `CORS_ORIGINS`에 쉼표로 구분해 지정합니다. `https://`를 포함한 정확한 출처를 입력하고 끝에 `/`를 붙이지 않습니다. Vercel Production 주소와 테스트에 사용할 Preview 주소를 함께 등록할 수 있으며, Preview 배포 주소가 바뀌면 값을 갱신해야 합니다. 쿠키를 포함한 요청을 위해 허용된 출처에 자격 증명 전송을 허용합니다. `CORS_ORIGINS`가 없으면 브라우저 출처를 허용하지 않습니다.

로컬 개발 시 `.env.example`의 `http://localhost:3000`을 참고하세요.

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
