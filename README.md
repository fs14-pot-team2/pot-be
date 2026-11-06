# POT Backend

POT (Plant On Trust)은 식물 돌봄이 필요한 팟오너와 방문 돌봄을 제공하는 팟트너를 연결하는 서비스입니다. 이 저장소는 API 서버를 담당합니다. Express 앱, `/health` 확인 주소, Prisma 초기 모델과 마이그레이션, PostgreSQL 개발 환경, 배포 기반이 준비되어 있습니다. 도메인 API는 구현 중입니다.

## 기술 구성

- Node.js 24, Express 5, TypeScript
- PostgreSQL 17, Prisma 7
- ESLint, Prettier, Husky, GitHub Actions
- 배포: AWS Elastic Beanstalk (`develop` push 시 개발 환경 배포 작업 실행)

## HTTPS 운영 설정

단일 인스턴스 Elastic Beanstalk의 nginx가 `pot-api.duckdns.org`에서 HTTPS를 처리합니다. 배포 설정은 인스턴스의 공인 IP를 DuckDNS에 등록하고, Let's Encrypt 인증서를 발급한 뒤 443 포트를 엽니다. 인증서와 DuckDNS 주소는 하루 두 번 확인·갱신합니다.

운영 주소는 <https://pot-api.duckdns.org>입니다. Elastic Beanstalk 환경 속성의 `DUCKDNS_TOKEN`과 `ACME_EMAIL`을 사용해 인증서를 발급·갱신합니다. 두 값은 Git, PR, 채팅에 적지 않습니다. 배포 후 <https://pot-api.duckdns.org/health>에서 `{"status":"ok"}`를 확인합니다.

인스턴스가 바뀌어 공인 IP가 달라지면 배포 또는 정기 갱신 시 DuckDNS 주소를 다시 맞춥니다. 인증서 발급에 필요한 도메인과 환경 속성이 누락되면 배포가 실패할 수 있습니다. Elastic Beanstalk 기본 주소의 HTTP `/health`는 상태 확인용으로 유지됩니다.

## RDS TLS 연결 설정

Elastic Beanstalk의 애플리케이션 배포 및 환경 속성 변경 시 서울 리전의 AWS RDS CA 인증서 번들을 `/etc/pot/rds-ca.pem`에 자동 설치합니다. 설치 디렉터리는 `0755`, 인증서 파일은 `0644` 권한으로 생성되어 애플리케이션 실행 사용자인 `webapp`이 읽을 수 있습니다. 인증서 다운로드 또는 PEM 형식 검증에 실패하면 암호화되지 않거나 검증되지 않은 DB 연결로 실행되지 않도록 배포가 실패합니다.

개발 RDS에 연결하는 Elastic Beanstalk 환경 속성의 `DATABASE_URL`에는 기존 사용자명, 비밀번호, 호스트, 데이터베이스명과 기존 쿼리 파라미터를 유지한 채 다음 옵션을 추가합니다.

```text
sslmode=verify-full&sslrootcert=/etc/pot/rds-ca.pem
```

예를 들어 기존 URL에 `?schema=public`이 있다면 다음과 같이 `&`로 이어 붙입니다. 실제 사용자명, 비밀번호와 RDS 주소는 Git, PR, 채팅에 기록하지 않습니다.

```text
postgresql://<사용자명>:<비밀번호>@<RDS-엔드포인트>:5432/pot_dev?schema=public&sslmode=verify-full&sslrootcert=/etc/pot/rds-ca.pem
```

`@prisma/adapter-pg`에 전달되는 `pg` 연결 문자열 파서는 `sslrootcert`의 인증서를 CA로 읽고, `sslmode=verify-full`에서 인증서 체인과 RDS 호스트 이름을 모두 검증합니다. 별도의 TLS 우회 옵션이나 코드 설정은 사용하지 않습니다. TLS 파라미터가 없는 로컬 및 CI의 `DATABASE_URL`은 기존 방식으로 동작합니다.

### 안전한 적용 순서

CA 파일이 없는 상태에서 `DATABASE_URL`만 먼저 변경하면 애플리케이션이 시작되지 않을 수 있으므로 다음 순서를 지킵니다.

1. 이 배포 훅이 포함된 코드를 먼저 `develop`에 배포하되, 기존 `DATABASE_URL`은 변경하지 않습니다.
2. 배포가 성공하면 인스턴스에서 `test -r /etc/pot/rds-ca.pem`을 실행해 인증서 파일을 읽을 수 있는지 확인합니다.
3. `openssl crl2pkcs7 -nocrl -certfile /etc/pot/rds-ca.pem -out /dev/null`을 실행해 인증서 번들이 정상인지 확인합니다.
4. Elastic Beanstalk 콘솔의 **구성 → 업데이트, 모니터링 및 로깅 → 환경 속성**에서 기존 `DATABASE_URL`의 다른 값을 보존한 채 `sslmode=verify-full`과 `sslrootcert=/etc/pot/rds-ca.pem`을 추가합니다.
5. 환경 속성 업데이트가 완료되고 환경 상태가 정상으로 돌아오면 `/health`와 로그인 API를 순서대로 확인합니다.

환경 속성 변경 배포에서도 동일한 CA 설치 훅이 먼저 실행되므로 파일이 없거나 손상된 상태에서는 배포가 중단됩니다. 새 인스턴스로 교체되는 애플리케이션 배포에서도 인증서를 다시 설치합니다.

## 시작하기

Node.js **24.16.0**, npm **11.x**를 사용합니다. 저장소 루트에서 실행하세요.

```bash
nvm use
cp .env.example .env
npm ci
npm run dev
```

<http://localhost:4000/health>에서 `{"status":"ok"}` 응답을 확인할 수 있습니다. 현재 `/health`는 DB에 접속하지 않으므로 PostgreSQL을 켜지 않아도 실행됩니다.

브라우저에서 API를 호출할 프론트 주소는 `CORS_ORIGINS`에 쉼표로 구분해 지정합니다. 주소는 `https://`를 포함한 정확한 출처여야 하며 끝에 `/`를 붙이지 않습니다. 로컬 `.env.example`에는 `http://localhost:3000`이 들어 있습니다. 빈스톡 환경 속성에는 실제 Vercel Production 주소와 테스트에 사용할 Preview 주소를 입력하세요. Preview 배포 주소가 바뀌면 이 값도 갱신해야 합니다. `CORS_ORIGINS`가 없으면 브라우저 출처를 허용하지 않습니다. 쿠키를 포함한 요청을 위해 허용된 출처에는 자격 증명 전송을 허용합니다.

DB를 사용하는 기능을 개발할 때는 Docker를 설치하고 로컬 PostgreSQL 컨테이너를 실행하세요.

```bash
docker compose up -d
```

`compose.yml`은 개발용 `pot` 데이터베이스를 로컬 컴퓨터의 `127.0.0.1:5432`에 연결하며, 다른 컴퓨터에서 직접 접속할 수 없도록 제한합니다.

DB를 처음 실행하기 전에 `.env.example`을 복사한 `.env` 파일에서 `POSTGRES_PASSWORD`에 개인 DB 비밀번호를 설정하고, `DATABASE_URL`에도 동일한 비밀번호를 입력해야 합니다. `localhost`는 본인 컴퓨터를 의미하므로 변경할 필요가 없습니다.

`npm ci`의 Prisma Client 생성과 빌드는 DB에 접속하지 않습니다. 실제 DB를 사용하는 기능, 마이그레이션, 시딩에는 올바른 `DATABASE_URL`이 필요합니다.

이미 PostgreSQL을 사용 중인 경우, `.env` 또는 `compose.yml`만 변경해도 기존 DB 계정의 비밀번호는 자동으로 변경되지 않습니다. 기존 데이터를 보존하면서 실제 PostgreSQL 계정의 비밀번호도 별도로 변경해야 합니다.

`.env`와 실제 비밀번호는 Git에 올리지 않습니다. 기존 Docker 볼륨을 삭제하면 저장된 DB 데이터가 사라질 수 있으므로 주의하세요.

`develop`에는 Prisma 모델과 초기 마이그레이션 파일이 있습니다. `npm run prisma:validate`로 스키마를 검사하고 `npm run prisma:generate`로 클라이언트를 생성할 수 있습니다. 로컬 DB와 운영 RDS는 별개입니다. 운영 RDS 접속 확인만으로 마이그레이션 적용이 확인되는 것은 아닙니다. DB 접근 코드를 작성할 때는 Prisma 7의 PostgreSQL 드라이버 어댑터와 마이그레이션 적용 절차를 팀에서 확인하세요.

## 폴더 구성

| 경로                              | 용도                                      |
| --------------------------------- | ----------------------------------------- |
| `prisma/`                         | 데이터 모델과 초기 마이그레이션·추후 시드 |
| `src/config/`                     | 환경변수와 공통 PrismaClient 설정         |
| `src/routes/`                     | 도메인별 엔드포인트와 미들웨어 연결       |
| `src/controllers/`                | HTTP 요청·응답 처리                       |
| `src/services/`                   | 비즈니스 로직                             |
| `src/repositories/`               | DB 접근                                   |
| `src/validators/`                 | 요청 입력값 검증                          |
| `src/middlewares/`, `src/errors/` | 공통 요청 처리와 오류 응답                |
| `src/types/`, `src/utils/`        | 공통 타입과 유틸리티                      |
| `src/app.ts`, `src/index.ts`      | Express 앱 구성과 서버 시작               |

여러 폴더는 `.gitkeep`만 있는 빈 자리입니다. 기능을 구현할 때 필요한 파일을 추가합니다.

## 작업 흐름

할 일과 진행 상태는 [POT 개발 일정](https://github.com/orgs/fs14-pot-team2/projects/1)의 **백엔드** 보드에서 관리합니다.

1. `pot-be`에 작업 Issue를 만들고 프로젝트의 **Todo**에 추가합니다.
2. 작업을 시작할 때 Issue를 **In Progress**로 옮기고 `develop`에서 작업 브랜치를 만듭니다. 예: `feat/care-request-api`.
3. 작업이 끝나면 `develop`을 대상으로 PR을 만들고, PR 오른쪽 **Development**에서 해당 Issue를 연결합니다. PR 제목과 커밋은 `feat: 돌봄 요청 API 구현`처럼 팀의 형식을 사용합니다.
4. 리뷰와 CI 확인 후 PR을 `develop`에 머지합니다. 현재 기본 브랜치는 `develop`입니다. 같은 저장소의 Issue를 자동 종료하려면 PR 본문에 `Closes #번호`를 적거나 PR의 **Development**에서 Issue를 연결합니다. 프로젝트에서 Issue 종료 시 **Done**으로 이동하는 워크플로가 켜져 있어야 상태도 함께 바뀝니다.
5. 개발 기간에는 `develop` push 후 GitHub Actions가 품질 검사와 DB 통합 검사를 통과한 코드를 Elastic Beanstalk 개발 환경에 배포합니다. 운영 전환 시에는 배포 대상을 `main`으로 되돌리고 운영 DB 마이그레이션과 환경변수 전환 절차를 별도로 진행합니다.

## 코드 규칙과 검사

- 레이어드 아키텍처를 사용하고 도메인당 라우터 하나를 둡니다.
- 파일명은 `kebab-case`, 변수·함수는 `camelCase`, 공통 상수는 `UPPER_SNAKE_CASE`를 사용합니다.
- 들여쓰기 2칸, 큰따옴표, 세미콜론을 사용합니다.
- 커밋과 PR 제목은 `feat/fix/refactor/chore/style/test: 한글 설명` 형식을 사용합니다.
- 제품 코드 변경 없이 테스트 코드를 추가하거나 수정할 때는 `test` 타입을 사용합니다.
- DB 연결이 필요 없는 단위 테스트는 `*.unit.test.ts`, PostgreSQL을 사용하는 통합 테스트는 `*.integration.test.ts`로 작성합니다.

```bash
npm run lint
npm run format:check
npm run prisma:validate
npm run typecheck
npm run build
npm run test:unit
```

`npm ci`로 설치하면 Husky가 설정되어 커밋 전에 변경 파일 검사와 커밋 메시지 검사가 실행됩니다. GitHub Actions도 `main`·`develop` 대상 PR과 해당 브랜치의 push에서 품질 검사를 수행합니다. 검사에서 실패하면 로그를 확인하고 수정한 뒤 다시 push하세요.

DB 통합 테스트는 GitHub Actions가 작업마다 생성하는 임시 PostgreSQL에 마이그레이션을 적용한 뒤 실행합니다. 테스트 데이터는 각 테스트가 직접 준비하며 시딩 데이터, 개인 로컬 DB, 운영 RDS를 사용하지 않습니다. 임시 DB는 외부 포트를 열지 않고 작업이 끝나면 함께 삭제됩니다. `develop` 배포는 품질 검사와 DB 통합 검사가 모두 성공해야 실행됩니다. 이 통합 테스트의 마이그레이션은 임시 DB에만 적용되므로, Prisma 마이그레이션이 추가된 PR은 개발 RDS의 `pot_dev`에도 별도 적용해야 합니다.

### Prisma 마이그레이션 포함 PR 머지 절차

`prisma/migrations/`에 새 마이그레이션이 포함된 PR은 코드가 먼저 자동 배포되지 않도록 다음 순서로 진행합니다.

1. 로컬 DB에서 `prisma migrate dev`로 마이그레이션 파일을 생성하고 PR에 포함합니다.
2. PR의 코드 리뷰와 품질 검사, DB 통합 테스트가 모두 성공했는지 확인합니다. 이 단계에서는 아래의 개발 RDS 수동 적용을 먼저 진행하기 위해 PR 머지만 잠시 대기합니다.
3. 최종 승인된 PR 브랜치를 EC2의 마이그레이션 작업 디렉터리에서 받은 뒤, 개발 RDS의 `pot_dev`를 대상으로 `npx prisma migrate status`를 실행합니다.
4. 접속 대상이 `pot_dev`임을 확인하고 `npx prisma migrate deploy`를 실행합니다. 접속 정보와 RDS CA 설정은 [개발용 더미 데이터 시딩 안내](prisma/README.md)의 개발 RDS 연결 주의사항을 따릅니다.
5. 다시 `npx prisma migrate status`를 실행해 스키마가 최신 상태인지 확인합니다. 실패했다면 PR을 머지하거나 애플리케이션을 배포하지 않습니다.
6. 마이그레이션 적용이 성공한 경우에만 PR을 `develop`에 머지합니다. 이후 GitHub Actions 검사를 통과하면 최신 애플리케이션이 자동 배포됩니다.

수동 적용이 끝나면 기능 코드, 마이그레이션 파일, 테스트 파일을 포함한 PR 전체를 `develop`에 머지합니다. 기존 테스트 파일을 삭제하거나 별도 브랜치에서 관리하지 않습니다.

개발 RDS에서는 `prisma migrate reset`, `prisma db push`, 운영용이 아닌 시딩을 실행하지 않습니다. 컬럼 삭제나 타입 변경처럼 기존 코드와 호환되지 않는 마이그레이션은 위 절차로 바로 적용하지 말고 배포 중단 시간과 데이터 보존 방법을 팀에서 먼저 합의합니다.

## 도움과 관련 저장소

- 작업 중 막히거나 변경 제안이 있으면 이 저장소에 Issue를 남기고 담당 팀원과 논의해 주세요.
- 사용자 화면은 [pot-fe](https://github.com/fs14-pot-team2/pot-fe)에서 관리합니다.
