import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../src/config/prisma.js";

test("Prisma 마이그레이션으로 주요 테이블을 생성한다", async (context) => {
  context.after(async () => {
    await prisma.$disconnect();
  });

  const tables = await prisma.$queryRaw<Array<{ tableName: string }>>`
    SELECT table_name AS "tableName"
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `;
  const tableNames = new Set(tables.map(({ tableName }) => tableName));

  assert.equal(tableNames.has("User"), true);
  assert.equal(tableNames.has("CareRequest"), true);
  assert.equal(tableNames.has("Quote"), true);
});
