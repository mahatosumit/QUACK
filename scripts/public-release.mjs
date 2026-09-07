import { copyFile, lstat, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const forbiddenSegment = /^(?:\.git|\.quack(?:-.*)?|\.claude|\.codex|\.agents|\.progress|\.phase1-checks|graphify-out|coverage|\.cache|cache|caches|logs)$/i;
const forbiddenFile = /(?:^\.env(?:\.|$)|\.(?:sqlite(?:-wal|-shm)?|db|log|jsonl|pem|key|p12|pfx)$|(?:^|[-_.])(?:credentials?|secrets?|passwords?)(?:[-_.]|$))/i;
const testOutput = /(?:\.test\.|\.e2e\.)/i;

function relativePath(value) {
  if (typeof value !== "string" || !value || value.includes("\\") || isAbsolute(value) || value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Public manifest paths must be normalized relative paths.");
  }
  return value;
}

function inside(root, target) {
  const path = relative(root, target);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export function isPrivateArtifact(path) {
  const parts = path.replaceAll("\\", "/").split("/");
  const file = parts.at(-1);
  const dependencySource = parts[0] === "node_modules" && /\.(?:[cm]?js|[cm]?ts)(?:\.map)?$/i.test(file);
  return parts.some((part) => forbiddenSegment.test(part)) || /^\.env(?:\.|$)/i.test(file) || (!dependencySource && forbiddenFile.test(file));
}

async function assertRegularPath(root, path) {
  let current = root;
  for (const part of relativePath(path).split("/")) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error(`Symlink is not allowed in public artifacts: ${path}`);
  }
  if (!inside(await realpath(root), await realpath(current))) throw new Error(`Public artifact escapes source root: ${path}`);
}

export async function readPublicManifest(root = repositoryRoot) {
  const manifest = JSON.parse(await readFile(join(root, "packaging", "public-files.json"), "utf8"));
  if (manifest.version !== 1 || !Array.isArray(manifest.files) || !Array.isArray(manifest.windowsFiles)) throw new Error("Invalid public artifact manifest.");
  const paths = [...manifest.files, ...manifest.windowsFiles].map(relativePath);
  if (new Set(paths).size !== paths.length || paths.some(isPrivateArtifact)) throw new Error("Public manifest contains duplicate or private paths.");
  return manifest;
}

async function copyAllowed(root, destination, sourcePath, outputPath = sourcePath) {
  await assertRegularPath(root, sourcePath);
  if (!(await lstat(join(root, sourcePath))).isFile()) throw new Error(`Public manifest entry must be a file: ${sourcePath}`);
  const target = join(destination, outputPath);
  await mkdir(resolve(target, ".."), { recursive: true });
  await copyFile(join(root, sourcePath), target);
}

export async function verifyPublicRelease(destination, manifest) {
  manifest ??= await readPublicManifest();
  let files = 0;
  const allowed = new Set([...manifest.files, ...manifest.windowsFiles.map((path) => path.split("/").at(-1))]);
  async function visit(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Symlink is not allowed in public artifacts: ${path}`);
      // Installed dependencies have their own licenses and fixtures; application state is never allowed.
      if (isPrivateArtifact(path)) throw new Error(`Private or local-state artifact is not allowed: ${path}`);
      if (path.startsWith("dist/") && testOutput.test(path)) throw new Error(`Compiled test is not allowed in runtime artifacts: ${path}`);
      if (entry.isDirectory()) await visit(join(directory, entry.name), path);
      else {
        if (!allowed.has(path) && !path.startsWith("dist/") && !path.startsWith("node_modules/")) throw new Error(`File is not in the public manifest: ${path}`);
        files++;
      }
    }
  }
  await visit(destination);
  return { files };
}

export async function stagePublicRelease({ root = repositoryRoot, outputRoot, windows = false } = {}) {
  const requestedRoot = resolve(root);
  const requestedOutput = resolve(outputRoot ?? join(requestedRoot, "release"));
  if (!inside(requestedRoot, requestedOutput)) throw new Error("Release output must be below the repository root.");
  const outputRelative = relative(requestedRoot, requestedOutput);
  root = await realpath(requestedRoot);
  outputRoot = join(root, outputRelative);
  let current = root;
  for (const part of relative(root, outputRoot).split(sep)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error("Release output must not traverse symlinks.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await mkdir(current);
    }
  }
  const manifest = await readPublicManifest(root);
  const runDirectory = join(outputRoot, `run-${randomUUID()}`);
  const destination = join(runDirectory, windows ? "quack-os-windows-portable" : "quack-os");
  await mkdir(destination, { recursive: true });
  for (const path of manifest.files) await copyAllowed(root, destination, path);
  if (windows) {
    for (const path of manifest.windowsFiles) await copyAllowed(root, destination, path, path.split("/").at(-1));
  }
  async function copyRuntime(directory = "dist") {
    await assertRegularPath(root, directory);
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (isPrivateArtifact(path)) throw new Error(`Private file found in compiled runtime: ${path}`);
      if (testOutput.test(path)) continue;
      if (entry.isDirectory()) await copyRuntime(path);
      else await copyAllowed(root, destination, path);
    }
  }
  await copyRuntime();
  await verifyPublicRelease(destination, manifest);
  return { destination, runDirectory };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "verify") {
      if (!process.argv[3]) throw new Error("A staged release directory is required.");
      const result = await verifyPublicRelease(resolve(process.argv[3]));
      console.log(`Public artifact validation passed (${result.files} files).`);
    } else if (process.argv[2] === "stage") {
      const result = await stagePublicRelease({ windows: process.argv.includes("--windows"), outputRoot: process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : undefined });
      console.log(JSON.stringify(result));
    } else {
      throw new Error("Usage: node scripts/public-release.mjs stage [output-root] [--windows] | verify <directory>");
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
