import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

const roots = ["src", "scripts"];
const failures = [];

for (const root of roots) await walk(root);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Static quality checks passed.");
}
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if ([".ts", ".js", ".mjs"].includes(extname(entry.name))) await inspect(path);
  }
}

async function inspect(path) {
  const normalized = path.split("\\").join("/");
  const source = await readFile(path, "utf8");
  if (/^<<<<<<< |^=======|^>>>>>>> /m.test(source)) failures.push(`${path}: unresolved merge marker`);
  if (source.includes("\0")) failures.push(`${path}: NUL byte`);
  if (!normalized.endsWith(".test.ts") && /@ts-(?:ignore|expect-error)/.test(source)) failures.push(`${path}: TypeScript suppression in production code`);

  // ADR 0040 process policy: production src must not construct shell
  // command strings. Exempt: test files, scripts/, the governed platform
  // process abstraction itself, cli.ts (execFile argv), and the terminal
  // tool's explicit permission-gated shell path.
  const isTest = /\.test\.[cm]?[jt]s$/.test(normalized) || normalized.includes(".e2e.");
  const exempt = normalized.startsWith("scripts/")
    || normalized === "src/platform/process.ts"
    || normalized === "src/cli.ts"
    || normalized === "src/tools/terminal.ts";
  const inProductionSrc = normalized.startsWith("src/");
  if (inProductionSrc && !isTest && !exempt) {
    if (/execSync\s*\(/.test(source)) failures.push(`${path}: execSync (shell string) in production code — use src/platform/process.ts executeProcess`);
    if (/2>&1/.test(source)) failures.push(`${path}: shell stderr merge (2>&1) in production code`);
    if (/\|\|\s*(?:true|echo)/.test(source)) failures.push(`${path}: shell || true/|| echo masking in production code`);
  }
}
