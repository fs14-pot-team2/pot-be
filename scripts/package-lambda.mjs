import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const nodeModulesRoot = path.join(projectRoot, "node_modules");
const buildRoot = path.join(projectRoot, ".lambda-build", "care-request-expiration");
const artifactDirectory = path.join(projectRoot, "artifacts", "lambda");
const artifactPath = path.join(artifactDirectory, "care-request-expiration.zip");
const handlerPath = "dist/lambda/care-request-expiration-handler.js";
const runtimePackageNames = ["@prisma/adapter-pg", "@prisma/client", "dotenv", "pg"];

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

async function copyFileWithDirectory(sourcePath, destinationPath) {
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath);
}

async function copyJavaScriptTree(sourceDirectory, destinationDirectory) {
  const entries = await readdir(sourceDirectory, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDirectory, entry.name);
    const destinationPath = path.join(destinationDirectory, entry.name);

    if (entry.isDirectory()) {
      await copyJavaScriptTree(sourcePath, destinationPath);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      await copyFileWithDirectory(sourcePath, destinationPath);
    }
  }
}

async function findPackageDirectory(packageName, fromDirectory) {
  const requireFromPackage = createRequire(path.join(fromDirectory, "package.json"));
  const entryPath = requireFromPackage.resolve(packageName);
  let candidateDirectory = path.dirname(entryPath);

  while (candidateDirectory.startsWith(nodeModulesRoot)) {
    try {
      const manifest = await readJson(path.join(candidateDirectory, "package.json"));

      if (manifest.name === packageName) {
        return candidateDirectory;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }

    const parentDirectory = path.dirname(candidateDirectory);

    if (parentDirectory === candidateDirectory) {
      break;
    }

    candidateDirectory = parentDirectory;
  }

  throw new Error(`${packageName} 패키지 경로를 찾을 수 없습니다.`);
}

async function copyRuntimePackageClosure() {
  const queue = runtimePackageNames.map((packageName) => ({
    packageName,
    fromDirectory: projectRoot,
    optional: false,
  }));
  const copiedDirectories = new Set();
  const runtimeVersions = {};

  while (queue.length > 0) {
    const current = queue.shift();
    let packageDirectory;

    try {
      packageDirectory = await findPackageDirectory(current.packageName, current.fromDirectory);
    } catch (error) {
      if (current.optional) {
        continue;
      }

      throw error;
    }

    const realPackageDirectory = path.resolve(packageDirectory);

    if (copiedDirectories.has(realPackageDirectory)) {
      continue;
    }

    copiedDirectories.add(realPackageDirectory);

    const manifest = await readJson(path.join(packageDirectory, "package.json"));
    const relativePackagePath = path.relative(nodeModulesRoot, packageDirectory);
    const destinationDirectory = path.join(buildRoot, "node_modules", relativePackagePath);

    await mkdir(path.dirname(destinationDirectory), { recursive: true });
    await cp(packageDirectory, destinationDirectory, { recursive: true });

    if (runtimePackageNames.includes(manifest.name)) {
      runtimeVersions[manifest.name] = manifest.version;
    }

    for (const dependencyName of Object.keys(manifest.dependencies ?? {})) {
      if (!dependencyName.startsWith("@types/")) {
        queue.push({
          packageName: dependencyName,
          fromDirectory: packageDirectory,
          optional: false,
        });
      }
    }

    for (const dependencyName of Object.keys(manifest.optionalDependencies ?? {})) {
      queue.push({
        packageName: dependencyName,
        fromDirectory: packageDirectory,
        optional: true,
      });
    }
  }

  return runtimeVersions;
}

async function findNativeFiles(directory) {
  const nativeExtensions = new Set([".node", ".so", ".dylib", ".dll"]);
  const nativeFiles = [];

  async function visit(currentDirectory) {
    const entries = await readdir(currentDirectory, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && nativeExtensions.has(path.extname(entry.name))) {
        nativeFiles.push(path.relative(buildRoot, entryPath));
      }
    }
  }

  await visit(directory);

  return nativeFiles;
}

const nodeMajorVersion = Number(process.versions.node.split(".")[0]);

if (nodeMajorVersion !== 24) {
  throw new Error(`Node.js 24.x가 필요합니다. 현재 버전: ${process.version}`);
}

await rm(buildRoot, { recursive: true, force: true });
await rm(artifactPath, { force: true });
await mkdir(buildRoot, { recursive: true });
await mkdir(artifactDirectory, { recursive: true });

run("npm", ["run", "prisma:generate"]);
run("npm", ["run", "build"]);

const runtimeFiles = [
  handlerPath,
  "dist/config/env.js",
  "dist/config/prisma.js",
  "dist/repositories/care-request-repository.js",
  "dist/services/care-request-expiration.js",
  "dist/utils/kst-date.js",
  "dist/utils/serialize-date.js",
];

for (const runtimeFile of runtimeFiles) {
  await copyFileWithDirectory(
    path.join(projectRoot, runtimeFile),
    path.join(buildRoot, runtimeFile),
  );
}

await copyJavaScriptTree(
  path.join(projectRoot, "dist", "generated", "prisma"),
  path.join(buildRoot, "dist", "generated", "prisma"),
);

const rootManifest = await readJson(path.join(projectRoot, "package.json"));
const runtimeVersions = await copyRuntimePackageClosure();
const lambdaManifest = {
  name: "pot-care-request-expiration-lambda",
  version: rootManifest.version,
  private: true,
  type: "module",
  engines: {
    node: "24.x",
  },
  dependencies: Object.fromEntries(
    runtimePackageNames.map((packageName) => [packageName, runtimeVersions[packageName]]),
  ),
};

await writeFile(
  path.join(buildRoot, "package.json"),
  `${JSON.stringify(lambdaManifest, null, 2)}\n`,
  "utf8",
);

const nativeFiles = await findNativeFiles(path.join(buildRoot, "node_modules"));

if (nativeFiles.length > 0) {
  throw new Error(
    `Linux x86_64 호환성을 보장할 수 없는 네이티브 파일이 포함되었습니다:\n${nativeFiles.join("\n")}`,
  );
}

const stagedHandlerUrl = pathToFileURL(path.join(buildRoot, handlerPath)).href;
run(
  process.execPath,
  ["--input-type=module", "--eval", `await import(${JSON.stringify(stagedHandlerUrl)})`],
  {
    cwd: buildRoot,
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://lambda_package_check:unused@127.0.0.1:5432/unused",
    },
  },
);

run("zip", ["-qr", artifactPath, "."], { cwd: buildRoot });

console.log(`Lambda ZIP 생성 완료: ${artifactPath}`);
console.log(
  "Lambda Handler: dist/lambda/care-request-expiration-handler.expirePastCareRequestsHandler",
);
