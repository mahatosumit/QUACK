import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isPrivateArtifact, stagePublicRelease, verifyPublicRelease } from "./public-release.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "quack-public-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = { version: 1, files: ["README.md", "docs/guide.md"], windowsFiles: [] };
  for (const directory of ["packaging", "docs", "dist", ".quack", "release/old"]) await mkdir(join(root, directory), { recursive: true });
  await writeFile(join(root, "packaging/public-files.json"), JSON.stringify(manifest));
  for (const [path, content] of Object.entries({ "README.md": "Public runtime", "docs/guide.md": "Public guide", "docs/private-notes.md": "Excluded", "dist/index.js": "export {};", "dist/index.test.js": "test fixture", ".quack/memory.json": "private local state", "release/old/user.txt": "preserve previous output" })) await writeFile(join(root, path), content);
  return { root, manifest };
}

test("public staging copies only allowlisted files and runtime, preserving private and previous data", async (t) => {
  const { root, manifest } = await fixture(t);
  const { destination } = await stagePublicRelease({ root });
  assert.equal(await readFile(join(destination, "dist/index.js"), "utf8"), "export {};");
  for (const path of [".quack/memory.json", "docs/private-notes.md", "dist/index.test.js"]) await assert.rejects(access(join(destination, path)), { code: "ENOENT" });
  assert.equal(await readFile(join(root, ".quack/memory.json"), "utf8"), "private local state");
  assert.equal(await readFile(join(root, "release/old/user.txt"), "utf8"), "preserve previous output");
  assert.deepEqual(await verifyPublicRelease(destination, manifest), { files: 3 });
  assert.notEqual((await stagePublicRelease({ root })).destination, destination);
});

test("public artifact validation rejects local state, credentials, sidecars and compiled tests", async (t) => {
  const { root, manifest } = await fixture(t);
  for (const path of [".quack/memory.json", ".quack-test/audit.jsonl", ".claude/settings.local.json", ".env.production", "quack.sqlite-wal", "credentials.json", "dist/runner.test.js", "docs/unapproved.md"]) {
    const { destination } = await stagePublicRelease({ root });
    await mkdir(join(destination, path, ".."), { recursive: true });
    await writeFile(join(destination, path), "fixture");
    await assert.rejects(verifyPublicRelease(destination, manifest), /not allowed|not in the public manifest/);
  }
});

test("public staging refuses outputs outside the repository, including sibling prefix collisions", async (t) => {
  const { root } = await fixture(t);
  await assert.rejects(stagePublicRelease({ root, outputRoot: `${root}-sibling` }), /below the repository/);
  await assert.rejects(stagePublicRelease({ root, outputRoot: root }), /below the repository/);
});

test("public staging rejects manifest traversal and private entries", async (t) => {
  const { root, manifest } = await fixture(t);
  for (const path of ["../outside.txt", ".quack/memory.json", "docs/../README.md"]) {
    await writeFile(join(root, "packaging/public-files.json"), JSON.stringify({ ...manifest, files: [path] }));
    await assert.rejects(stagePublicRelease({ root }), /relative paths|private paths/);
  }
});

test("public staging refuses a symlinked output directory", async (t) => {
  const { root } = await fixture(t);
  const linked = join(root, "release-link");
  try { await symlink(join(root, ".quack"), linked, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (["EPERM", "EACCES"].includes(error.code)) return t.skip("Host does not permit test symlinks"); throw error; }
  await assert.rejects(stagePublicRelease({ root, outputRoot: linked }), /symlinks/);
});

test("compiled runtime cannot carry credential or local state files", async (t) => {
  const { root } = await fixture(t);
  await writeFile(join(root, "dist/credentials.json"), "fixture");
  await assert.rejects(stagePublicRelease({ root }), /Private file/);
});

test("state classifier distinguishes source modules from private state", () => {
  assert.equal(isPrivateArtifact(".quack-test/audit.jsonl"), true);
  assert.equal(isPrivateArtifact("dist/memory/os.js"), false);
  assert.equal(isPrivateArtifact("docs/security/THREAT_MODEL.md"), false);
  assert.equal(isPrivateArtifact("node_modules/jose/dist/types/key/generate_secret.d.ts"), false);
  assert.equal(isPrivateArtifact("node_modules/jose/dist/webapi/key/generate_secret.js"), false);
  assert.equal(isPrivateArtifact("node_modules/provider/credentials.json"), true);
  assert.equal(isPrivateArtifact("node_modules/provider/.env"), true);
  assert.equal(isPrivateArtifact("node_modules/provider/.env.js"), true);
  assert.equal(isPrivateArtifact("node_modules/provider/private.key"), true);
  assert.equal(isPrivateArtifact("node_modules/.quack/private.js"), true);
});

test("secret-named runtime code is shippable while secret data files are not", () => {
  // Regression: the compiled SecretProvider itself must never be classified as
  // private data, or every staged release is silently incomplete.
  assert.equal(isPrivateArtifact("dist/security/secret-provider.js"), false);
  assert.equal(isPrivateArtifact("dist/security/secret-provider.d.ts"), false);
  assert.equal(isPrivateArtifact("dist/security/secret-provider.js.map"), false);
  assert.equal(isPrivateArtifact("password-reset-ui.js"), false);
  assert.equal(isPrivateArtifact("secret-vault.js"), false);
  // Genuine secret data shapes stay private.
  for (const path of ["secrets.json", "credentials", "password.txt", "user-secrets.txt", "api.credentials", "provider-secrets.json", "my-secrets.yaml", "prod-credentials.env"]) {
    assert.equal(isPrivateArtifact(path), true, path);
  }
});
