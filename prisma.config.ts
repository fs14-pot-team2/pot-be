import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Client 생성과 빌드에는 DB 접속 주소가 필요하지 않습니다.
    // 마이그레이션 등 DB 명령은 주소가 없으면 Prisma가 오류를 냅니다.
    url: process.env.DATABASE_URL ?? "",
  },
});
