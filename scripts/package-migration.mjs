import { spawnSync } from "node:child_process";
import { chmod, cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceDirectory = path.join(projectRoot, "scripts", "migration-package");
const buildRoot = path.join(projectRoot, ".migration-build", "prisma-migrate");
const artifactDirectory = path.join(projectRoot, "artifacts", "migration");
const artifactPath = path.join(artifactDirectory, "prisma-migrate.zip");
const dockerImage =
  process.env.MIGRATION_PACKAGE_DOCKER_IMAGE ?? "public.ecr.aws/lambda/nodejs:24-x86_64";
const requiredFiles = [
  "package.json",
  "package-lock.json",
  "prisma.config.ts",
  "prisma/schema.prisma",
  "prisma/migrations/migration_lock.toml",
  "run-migrate.sh",
  "node_modules/prisma/build/index.js",
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} 실행에 실패했습니다.`);
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function listRelativeFiles(directory) {
  const files = [];

  async function visit(currentDirectory) {
    const entries = await readdir(currentDirectory, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        files.push(path.relative(directory, entryPath));
      }
    }
  }

  await visit(directory);
  return files;
}

function runInLinuxContainer(args) {
  const uid = typeof process.getuid === "function" ? String(process.getuid()) : "1000";
  const gid = typeof process.getgid === "function" ? String(process.getgid()) : "1000";

  run("docker", [
    "run",
    "--rm",
    "--platform",
    "linux/amd64",
    "--user",
    `${uid}:${gid}`,
    "--env",
    "HOME=/tmp/npm-home",
    "--env",
    "npm_config_cache=/tmp/npm-cache",
    "--volume",
    `${buildRoot}:/package`,
    "--workdir",
    "/package",
    "--entrypoint",
    "/usr/bin/env",
    dockerImage,
    ...args,
  ]);
}

const rootManifest = await readJson(path.join(projectRoot, "package.json"));
const packageManifest = await readJson(path.join(sourceDirectory, "package.json"));
const prismaVersion = rootManifest.devDependencies?.prisma;

if (!prismaVersion || packageManifest.dependencies.prisma !== prismaVersion) {
  throw new Error(
    `마이그레이션 패키지의 Prisma 버전(${packageManifest.dependencies.prisma})이 ` +
      `프로젝트 버전(${prismaVersion ?? "없음"})과 일치하지 않습니다.`,
  );
}

await rm(buildRoot, { recursive: true, force: true });
await rm(artifactPath, { force: true });
await mkdir(buildRoot, { recursive: true });
await mkdir(path.join(buildRoot, "prisma"), { recursive: true });
await mkdir(artifactDirectory, { recursive: true });

await cp(path.join(sourceDirectory, "package.json"), path.join(buildRoot, "package.json"));
await cp(
  path.join(sourceDirectory, "package-lock.json"),
  path.join(buildRoot, "package-lock.json"),
);
await cp(path.join(sourceDirectory, "run-migrate.sh"), path.join(buildRoot, "run-migrate.sh"));
await chmod(path.join(buildRoot, "run-migrate.sh"), 0o755);
await cp(path.join(projectRoot, "prisma.config.ts"), path.join(buildRoot, "prisma.config.ts"));
await cp(
  path.join(projectRoot, "prisma", "schema.prisma"),
  path.join(buildRoot, "prisma", "schema.prisma"),
  {
    recursive: true,
  },
);
await cp(
  path.join(projectRoot, "prisma", "migrations"),
  path.join(buildRoot, "prisma", "migrations"),
  { recursive: true },
);

runInLinuxContainer(["npm", "ci", "--omit=dev", "--no-audit", "--no-fund"]);

runInLinuxContainer([
  "node",
  "--input-type=module",
  "--eval",
  [
    'import { readdir, readFile } from "node:fs/promises";',
    'const directory = "node_modules/@prisma/engines";',
    "const names = await readdir(directory);",
    'const engineName = names.find((name) => name === "schema-engine-rhel-openssl-3.0.x");',
    'if (!engineName) throw new Error("Prisma schema engine을 찾을 수 없습니다.");',
    "const header = await readFile(`${directory}/${engineName}`);",
    'if (header.toString("ascii", 1, 4) !== "ELF") throw new Error("Prisma engine이 Linux ELF 파일이 아닙니다.");',
    'if (header.readUInt16LE(18) !== 62) throw new Error("Prisma engine이 x86_64 파일이 아닙니다.");',
    "console.log(`Linux x86_64 Prisma engine 확인: ${engineName}`);",
  ].join(" "),
]);
runInLinuxContainer(["node", "node_modules/prisma/build/index.js", "--version"]);
runInLinuxContainer(["node", "node_modules/prisma/build/index.js", "migrate", "deploy", "--help"]);

const packagedFiles = await listRelativeFiles(buildRoot);
const forbiddenPaths = packagedFiles.filter((filePath) => {
  const parts = filePath.split(path.sep);
  return parts.some(
    (part) =>
      part === ".aws" || part === "credentials" || part === ".env" || part.startsWith(".env."),
  );
});

if (forbiddenPaths.length > 0) {
  throw new Error(`패키지에 금지된 환경·인증 파일이 포함되었습니다:\n${forbiddenPaths.join("\n")}`);
}

for (const requiredFile of requiredFiles) {
  if (!packagedFiles.includes(requiredFile)) {
    throw new Error(`필수 파일이 패키지에 없습니다: ${requiredFile}`);
  }
}

const firstPartyFiles = [
  "package.json",
  "package-lock.json",
  "prisma.config.ts",
  "prisma/schema.prisma",
  "run-migrate.sh",
  ...packagedFiles.filter((filePath) =>
    filePath.startsWith(`prisma${path.sep}migrations${path.sep}`),
  ),
];
const secretPatterns = [
  /postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AWS_SECRET_ACCESS_KEY\s*=/,
  /AWS_ACCESS_KEY_ID\s*=/,
];

for (const relativePath of new Set(firstPartyFiles)) {
  const contents = await readFile(path.join(buildRoot, relativePath), "utf8");

  if (secretPatterns.some((pattern) => pattern.test(contents))) {
    throw new Error(`민감 정보로 의심되는 값이 포함되었습니다: ${relativePath}`);
  }
}

run("zip", ["-qry", artifactPath, "."], { cwd: buildRoot });
run("unzip", ["-tq", artifactPath]);

console.log(`Prisma 마이그레이션 ZIP 생성 완료: ${artifactPath}`);
console.log("CodeBuild 실행 명령: ./run-migrate.sh");
