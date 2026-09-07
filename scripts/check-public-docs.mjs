import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readPublicManifest } from "./public-release.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifest = await readPublicManifest(root);
const documents = new Set(manifest.files.filter((path) => path.endsWith(".md")));
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".md")) documents.add(entry.name);
}
documents.add("sdk/README.md");
const failures = [];

for (const path of manifest.files) {
  try { await access(join(root, path)); }
  catch { failures.push(`${path}: missing public manifest entry`); }
}

for (const path of documents) {
  const lines = (await readFile(join(root, path), "utf8")).split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const location = `${path}:${index + 1}`;
    if (/(?:[A-Za-z]:[\\/]Users[\\/]|\/Users\/|\/home\/)[^\s<>]+/i.test(line)) failures.push(`${location}: personal absolute path`);
    if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}.*placeholder/i.test(line)) failures.push(`${location}: placeholder contact address`);
    if (/\]\(\)/.test(line)) failures.push(`${location}: empty link destination`);
    for (const match of line.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].split(/\s+"/)[0].replace(/^<|>$/g, "").split("#")[0];
      if (!target || /^(?:[a-z]+:|\/)/i.test(target) || !/\.md$/i.test(target)) continue;
      try { await access(resolve(root, dirname(path), decodeURIComponent(target))); }
      catch { failures.push(`${location}: missing relative Markdown link`); }
    }
  }
}

const registry = JSON.parse(await readFile(join(root, "docs/CAPABILITY_REGISTRY.json"), "utf8"));
for (const capability of registry.capabilities) {
  for (const key of ["implementation", "adr", "rfc"]) {
    if (!capability[key]) continue;
    try { await access(join(root, capability[key])); }
    catch { failures.push(`docs/CAPABILITY_REGISTRY.json: ${capability.id} has a missing ${key} path`); }
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Public documentation checks passed (${documents.size} documents, ${manifest.files.length} manifest entries).`);
}
