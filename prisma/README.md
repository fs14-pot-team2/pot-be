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
- 시딩 코드는 `localhost` 또는 `127.0.0.1`의 `pot` 데이터베이스만 허용하도록 구성되어 있다.
- 기존 데이터는 `upsert`와 중복 조회를 통해 최대한 유지하므로 동일한 시딩을 반복 실행해도 기본적으로 데이터가 중복 생성되지 않는다.
- 기존 데이터의 업데이트를 생략하므로 JSON 원본을 변경하더라도 이미 저장된 모든 값이 자동 갱신되는 것은 아니다.
- `.env` 파일과 실제 운영 비밀번호는 Git에 커밋하지 않는다.
- JSON에 포함된 닉네임·리뷰·메시지는 실제 사용자 데이터가 아닌 가상의 합성 데이터다.
