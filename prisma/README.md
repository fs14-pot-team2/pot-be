# POT 개발용 더미 데이터 시딩

POT(Plant On Trust) 백엔드의 로컬 개발 및 시연을 위한 더미 데이터 실행 안내.

## 파일 구성

- `prisma/data/pot-seed.json`: 개발·시연용 합성 데이터 원본
- `prisma/seed.ts`: JSON 데이터를 PostgreSQL에 저장하는 시딩 코드

총 13개 모델에 약 1,937건의 데이터를 생성한다. 팟오너와 팟트너, 돌봄 요청, 견적, 지정 요청, 반려·숨김 내역, 리뷰, 대화 및 메시지가 포함된다.

## 실행 방법

저장소 루트(`pot-be`)에서 실행한다.

**1. 환경 변수 준비**

```bash
cp .env.example .env
```

`.env`에서 개인 `POSTGRES_PASSWORD`를 설정하고 `DATABASE_URL`에도 같은 비밀번호를 입력한다.

**2. 라이브러리 설치**

```bash
npm ci
```

**3. PostgreSQL 실행**

Docker Desktop 실행 후:

```bash
docker compose up -d
```

**4. 데이터베이스 마이그레이션 및 Prisma Client 생성**

```bash
npx prisma migrate deploy
npm run prisma:generate
```

**5. 더미 데이터 저장**

```bash
npx prisma db seed
```

### 개발 RDS의 `pot_dev` 시딩

개발 RDS에서는 `DATABASE_URL`이 `pot_dev`를 가리키는 것만으로 실행되지 않는다. `POT_DEV_RDS_HOST`와 `POT_DEV_SEED_CONFIRMATION`을 시딩 프로세스에 함께 전달해야 한다. 아래의 `개발-RDS-엔드포인트`는 실제 개발 RDS 엔드포인트로 바꾼다.

개발 RDS에는 TLS로 연결하고 AWS RDS CA 인증서로 서버 인증서와 호스트 이름을 검증한다. EC2에서는 서울 리전 인증서 번들을 사용자 홈에 내려받을 수 있다.

```bash
curl -fsSLo "$HOME/rds-ap-northeast-2-bundle.pem" \
  "https://truststore.pki.rds.amazonaws.com/ap-northeast-2/ap-northeast-2-bundle.pem"
```

`DATABASE_URL`에는 인증서의 절대 경로와 `verify-full`을 사용한다. 실제 사용자명, 비밀번호, 호스트는 문서나 Git에 기록하지 않는다.

```dotenv
DATABASE_URL="postgresql://사용자:비밀번호@개발-RDS-엔드포인트:5432/pot_dev?schema=public&sslmode=verify-full&sslrootcert=/인증서의/절대/경로/rds-ap-northeast-2-bundle.pem"
```

인증서 검증 오류를 `NODE_TLS_REJECT_UNAUTHORIZED=0`, `rejectUnauthorized=false` 또는 검증을 생략하는 SSL 설정으로 우회하지 않는다.

#### macOS / Linux (bash, zsh)

다음 방식은 두 환경 변수를 시딩 명령에만 전달하므로 실행 후 현재 셸에 남지 않는다.

```bash
POT_DEV_RDS_HOST="개발-RDS-엔드포인트" \
POT_DEV_SEED_CONFIRMATION="pot_dev" \
npx prisma db seed
```

#### Windows PowerShell

시딩의 성공 여부와 관계없이 승인 값이 남지 않도록 `finally`에서 두 환경 변수를 제거한다.

```powershell
$env:POT_DEV_RDS_HOST = "개발-RDS-엔드포인트"
$env:POT_DEV_SEED_CONFIRMATION = "pot_dev"

try {
  npx prisma db seed
} finally {
  Remove-Item Env:POT_DEV_RDS_HOST -ErrorAction SilentlyContinue
  Remove-Item Env:POT_DEV_SEED_CONFIRMATION -ErrorAction SilentlyContinue
}
```

#### Windows CMD

```bat
set "POT_DEV_RDS_HOST=개발-RDS-엔드포인트"
set "POT_DEV_SEED_CONFIRMATION=pot_dev"
npx prisma db seed
set "POT_DEV_RDS_HOST="
set "POT_DEV_SEED_CONFIRMATION="
```

CMD에서 시딩을 중간에 강제로 종료했다면 현재 터미널을 닫거나 위의 마지막 두 명령을 직접 실행해 환경 변수를 제거한다.

- `DATABASE_URL`의 데이터베이스 이름은 정확히 `pot_dev`여야 한다.
- 접속 호스트는 AWS RDS 도메인이어야 하며 `POT_DEV_RDS_HOST`와 정확히 일치해야 한다.
- `POT_DEV_SEED_CONFIRMATION` 값은 정확히 `pot_dev`여야 한다.
- `POT_DEV_SEED_CONFIRMATION`은 공용 또는 상시 `.env`에 저장하지 않고 시딩을 실행하는 세션에서만 설정한 뒤 제거한다.
- 비밀번호를 명령어나 문서에 직접 기록하지 않고 EC2의 기존 환경 설정을 사용한다.
- 세 조건 중 하나라도 충족하지 않으면 DB에 연결하기 전에 실행을 중단한다.
- 이 안전장치는 `prisma db seed`에만 적용된다. 애플리케이션 실행, 마이그레이션, `db push`, 수동 SQL의 권한은 DB 계정과 운영 절차로 별도 제한해야 한다.

**6. 데이터 확인**

```bash
npx prisma studio
```

Prisma Studio에서 각 테이블의 데이터를 확인할 수 있다.

## 시딩 데이터 구성

| 모델                |      건수 |
| ------------------- | --------: |
| User                |       130 |
| OwnerProfile        |        55 |
| SitterProfile       |        73 |
| SitterService       |       110 |
| SitterServiceRegion |       179 |
| CareRequest         |       236 |
| Quote               |       550 |
| DesignatedRequest   |       160 |
| RejectedRequest     |        33 |
| IgnoredRequest      |        20 |
| Review              |       143 |
| Conversation        |        32 |
| Message             |       216 |
| **합계**            | **1,937** |

확정 견적 162건은 기존 `CareRequest`와 `Quote` 사이의 연결이므로 별도 행으로 계산하지 않는다.

## 테스트 계정

- 사용자: JSON에 정의된 팟오너 55명, 팟트너 75명
- 공통 테스트 비밀번호: `PotTest!2026`
- 비밀번호는 프로젝트 공통 Argon2id 유틸리티를 사용해 해싱하여 저장한다.
- 미등록 상태의 팟트너 2명은 사용자 계정만 생성되며 프로필은 생성되지 않는다.

## 주의사항

- 로컬 개발 및 시연 목적으로만 사용한다. 운영 데이터베이스에 실행하지 않는다.
- 시딩 코드는 `localhost` 또는 `127.0.0.1`의 `pot`과 명시적으로 승인한 개발 RDS의 `pot_dev`만 허용한다.
- 원격 `pot`, 임의의 원격 DB, 예상 호스트와 다른 `pot_dev`는 실행 전에 차단한다.
- 기존 데이터는 `upsert`와 중복 조회를 통해 최대한 유지하므로 동일한 시딩을 반복 실행해도 기본적으로 데이터가 중복 생성되지 않는다.
- 기존 데이터의 업데이트를 생략하므로 JSON 원본을 변경하더라도 이미 저장된 모든 값이 자동 갱신되는 것은 아니다.
- `.env` 파일과 실제 운영 비밀번호는 Git에 커밋하지 않는다.
- JSON에 포함된 닉네임·리뷰·메시지는 실제 사용자 데이터가 아닌 가상의 합성 데이터다.
