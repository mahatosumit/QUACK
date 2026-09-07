import { readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const distRoot = resolve("dist");
const serialSuffixes = [
  `${sep}selfmod${sep}code-improvement-controller.integration.test.js`,
  `${sep}selfmod${sep}promotion.integration.test.js`,
];
const testFiles = collectTests(distRoot).sort();
const serial = testFiles.filter((file) => serialSuffixes.some((suffix) => file.endsWith(suffix)));
const ordinary = testFiles.filter((file) => !serial.includes(file));

let overallExitCode = 0;

function run(args) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    overallExitCode = result.status ?? 1;
  }
}

run(["--test", "--test-concurrency=4", ...ordinary]);
run(["--test", "--test-concurrency=1", ...serial]);

if (overallExitCode !== 0) {
  process.exit(overallExitCode);
}

function collectTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTests(path);
    return entry.isFile() && entry.name.endsWith(".test.js") ? [path] : [];
  });
}