import { inspect } from "node:util";

export default async function* summaryReporter(source) {
  const groups = new Map();
  const namesByFile = new Map();
  const failures = [];

  for await (const event of source) {
    const data = event.data ?? {};
    const file = data.file ?? "";

    if (event.type === "test:start") {
      const path = namesByFile.get(file) ?? [];

      path[data.nesting] = data.name;
      path.length = data.nesting + 1;
      namesByFile.set(file, path);

      if (data.nesting === 0) {
        const key = `${file}:${data.name}`;

        if (!groups.has(key)) {
          groups.set(key, {
            name: data.name,
            total: 0,
            passed: 0,
          });
        }
      }
    }

    const isTestResult =
      (event.type === "test:pass" || event.type === "test:fail") && data.details?.type === "test";

    if (isTestResult) {
      const path = namesByFile.get(file) ?? [];
      const name = path[0] ?? data.name;
      const key = `${file}:${name}`;

      if (!groups.has(key)) {
        groups.set(key, {
          name,
          total: 0,
          passed: 0,
        });
      }

      const group = groups.get(key);
      group.total++;

      if (event.type === "test:pass") {
        group.passed++;
      } else {
        failures.push({
          group: key,
          path: [...path.slice(1, data.nesting), data.name],
          file,
          line: data.line,
          error: data.details.error,
        });
      }
    }

    if (event.type === "test:summary" && !data.file) {
      for (const [key, group] of groups) {
        const succeeded = group.total === group.passed;

        yield `${succeeded ? "✔" : "✖"} ${group.name}  ${group.passed}/${group.total}\n`;

        for (const failure of failures.filter((item) => item.group === key)) {
          yield `  ✖ ${failure.path.join(" > ")}\n`;
          yield `    위치: ${failure.file}:${failure.line}\n`;

          const error = failure.error?.cause ?? failure.error;

          yield `    ${inspect(error, {
            colors: false,
            depth: 4,
          }).replaceAll("\n", "\n    ")}\n`;
        }
      }

      const counts = data.counts ?? {};

      yield [
        "",
        `총 ${counts.tests ?? 0}건 | PASS ${counts.passed ?? 0} | FAIL ${counts.failed ?? 0} | SKIP ${counts.skipped ?? 0} | TODO ${counts.todo ?? 0}`,
        "",
      ].join("\n");
    }
  }
}
