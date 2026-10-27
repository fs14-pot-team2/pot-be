# POT Backend

POT (Plant On Trust)은 식물 돌봄이 필요한 팟오너와 방문 돌봄을 제공하는 팟트너를 연결하는 서비스입니다. 이 저장소는 API 서버를 담당합니다. 현재는 Express 앱, `/health` 확인 주소, Prisma와 PostgreSQL 개발 환경, 배포 기반이 준비된 단계입니다. 도메인 API와 데이터 모델은 구현 중입니다.

## 기술 구성

- Node.js 24, Express 5, TypeScript
- PostgreSQL 17, Prisma 7
- ESLint, Prettier, Husky, GitHub Actions
- 배포: AWS Elastic Beanstalk (`main` push 시 배포 작업 실행)

## HTTPS 배포 준비

단일 인스턴스 Elastic Beanstalk의 nginx가 `pot-api.duckdns.org`에서 HTTPS를 처리합니다. 배포 설정은 인스턴스의 공인 IP를 DuckDNS에 등록하고, Let's Encrypt 인증서를 발급한 뒤 443 포트를 엽니다. 인증서와 DuckDNS 주소는 하루 두 번 확인·갱신합니다.

1. [DuckDNS](https://www.duckdns.org/)에 로그인해 `pot-api` 도메인을 등록합니다. 이미 사용 중인 이름이면 이 저장소의 HTTPS 설정에 있는 도메인도 함께 바꿔야 합니다.
2. Elastic Beanstalk 환경 속성에 `DUCKDNS_TOKEN`(DuckDNS 계정의 토큰)과 `ACME_EMAIL`(인증서 만료 알림을 받을 이메일)을 추가합니다. 토큰은 Git, PR, 채팅에 적지 않습니다.
3. HTTPS 설정이 `main`에 반영되면 배포가 인증서를 발급하고 nginx를 시작합니다. 배포 완료 후 `https://pot-api.duckdns.org/health`에서 `{"status":"ok"}`를 확인합니다.

도메인을 등록하고 두 환경 속성을 입력하기 전에는 이 변경을 `main`에 배포하지 마세요. 인증서 발급이 실패하면 배포가 중단됩니다. Elastic Beanstalk 기존 주소의 HTTP `/health`는 상태 확인용으로 유지됩니다. 인스턴스가 바뀌어 공인 IP가 달라져도 배포 또는 정기 갱신 시 DuckDNS 주소를 다시 맞춥니다.

## 시작하기

Node.js **24.16.0**, npm **11.x**를 사용합니다. 저장소 루트에서 실행하세요.

```bash
nvm use
npm ci
cp .env.example .env
npm run dev
```

<http://localhost:4000/health>에서 `{"status":"ok"}` 응답을 확인할 수 있습니다. 현재 `/health`는 DB에 접속하지 않으므로 PostgreSQL을 켜지 않아도 실행됩니다.

DB를 사용하는 기능을 개발할 때는 Docker를 설치하고 로컬 PostgreSQL 컨테이너를 실행하세요.

```bash
docker compose up -d
```

`compose.yml`은 개발용 `pot` 데이터베이스를 로컬 컴퓨터의 5432 포트에 만듭니다. `.env.example`의 `DATABASE_URL`은 이 컨테이너에 맞춘 예시입니다. 다른 DB를 사용한다면 각자 `.env`의 접속 정보를 바꾸세요. `.env`와 실제 비밀번호는 Git에 올리지 않습니다.

현재 Prisma 스키마에는 `postgresql` 데이터 소스만 있고 모델과 마이그레이션은 아직 없습니다. 모델을 추가한 뒤 `npm run prisma:validate`와 `npm run prisma:generate`로 확인할 수 있습니다. DB 접근 코드를 작성할 때는 Prisma 7의 PostgreSQL 드라이버 어댑터와 마이그레이션 방식을 팀에서 함께 결정해 적용해야 합니다.

## 폴더 구성

| 경로                              | 용도                                 |
| --------------------------------- | ------------------------------------ |
| `prisma/`                         | 데이터 모델과 추후 마이그레이션·시드 |
| `src/config/`                     | 환경변수와 공통 PrismaClient 설정    |
| `src/routes/`                     | 도메인별 엔드포인트와 미들웨어 연결  |
| `src/controllers/`                | HTTP 요청·응답 처리                  |
| `src/services/`                   | 비즈니스 로직                        |
| `src/repositories/`               | DB 접근                              |
| `src/validators/`                 | 요청 입력값 검증                     |
| `src/middlewares/`, `src/errors/` | 공통 요청 처리와 오류 응답           |
| `src/types/`, `src/utils/`        | 공통 타입과 유틸리티                 |
| `src/app.ts`, `src/index.ts`      | Express 앱 구성과 서버 시작          |

여러 폴더는 `.gitkeep`만 있는 빈 자리입니다. 기능을 구현할 때 필요한 파일을 추가합니다.

## 작업 흐름

할 일과 진행 상태는 [POT 개발 일정](https://github.com/orgs/fs14-pot-team2/projects/1)의 **백엔드** 보드에서 관리합니다.

1. `pot-be`에 작업 Issue를 만들고 프로젝트의 **Todo**에 추가합니다.
2. 작업을 시작할 때 Issue를 **In Progress**로 옮기고 `develop`에서 작업 브랜치를 만듭니다. 예: `feat/care-request-api`.
3. 작업이 끝나면 `develop`을 대상으로 PR을 만들고, PR 오른쪽 **Development**에서 해당 Issue를 연결합니다. PR 제목과 커밋은 `feat: 돌봄 요청 API 구현`처럼 팀의 형식을 사용합니다.
4. 리뷰와 CI 확인 후 PR을 `develop`에 머지합니다. 완료된 Issue를 닫으면 프로젝트의 **Done**으로 이동하도록 설정할 수 있습니다. `main`이 기본 브랜치이므로 `develop` 대상 PR에 `Closes #번호`를 적는 것만으로는 Issue가 자동 종료되지 않습니다.
5. 배포할 변경사항은 팀 일정에 맞춰 `develop`에서 `main`으로 별도 PR을 만듭니다. `main` push 후 GitHub Actions가 Elastic Beanstalk 배포를 실행합니다.

## 코드 규칙과 검사

- 레이어드 아키텍처를 사용하고 도메인당 라우터 하나를 둡니다.
- 파일명은 `kebab-case`, 변수·함수는 `camelCase`, 공통 상수는 `UPPER_SNAKE_CASE`를 사용합니다.
- 들여쓰기 2칸, 큰따옴표, 세미콜론을 사용합니다.
- 커밋과 PR 제목은 `feat/fix/refactor/chore/style: 한글 설명` 형식을 사용합니다.

```bash
npm run lint
npm run format:check
npm run prisma:validate
npm run typecheck
npm run build
```

`npm ci`로 설치하면 Husky가 설정되어 커밋 전에 변경 파일 검사와 커밋 메시지 검사가 실행됩니다. GitHub Actions도 `main`·`develop` 대상 PR과 해당 브랜치의 push에서 품질 검사를 수행합니다. 검사에서 실패하면 로그를 확인하고 수정한 뒤 다시 push하세요.

## 도움과 관련 저장소

- 작업 중 막히거나 변경 제안이 있으면 이 저장소에 Issue를 남기고 담당 팀원과 논의해 주세요.
- 사용자 화면은 [pot-fe](https://github.com/fs14-pot-team2/pot-fe)에서 관리합니다.
