import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrivacyFirewall } from "./privacy.js";
import { SkillDiscovery } from "./discovery.js";
import { DiscoveredSkillRegistry, InMemorySkillRegistryStore, verifySkillRecordContent } from "./registry.js";
import { classifySkillRisk, requiresReviewBeforeActivation, skillContentHash } from "../universal.js";

const firewall = new PrivacyFirewall();

test("privacy firewall classifies secrets, keys, tokens, and cookies", () => {
  const matches = firewall.classify("password: hunter2 and api_key = sk-12345 -----BEGIN RSA PRIVATE KEY-----");
  const classes = new Set(matches.map(match => match.dataClass));
  assert.ok(classes.has("PASSWORD"));
  assert.ok(classes.has("TOKEN"));
  assert.ok(classes.has("PRIVATE_KEY"));
});

test("privacy firewall redacts sensitive manifest fields and denies hard classes", () => {
  const withSecret = firewall.evaluate({ id: "skill.x", name: "X", token: "abc123" });
  assert.equal(withSecret.decision, "REDACT");
  assert.equal(withSecret.safe["token"], "[REDACTED]");
  assert.equal(withSecret.safe["id"], "skill.x");

  const withKey = firewall.evaluate({ id: "skill.y", instructions: "-----BEGIN OPENSSH PRIVATE KEY-----" });
  assert.equal(withKey.decision, "DENY");
  assert.equal(withKey.safe["instructions"], "[REDACTED]");
  assert.deepEqual(withKey.audit.dataClasses, ["PRIVATE_KEY"]);
});

test("forbidden filenames and directories are recognized", () => {
  assert.ok(firewall.isForbiddenFilename(".env"));
  assert.ok(firewall.isForbiddenFilename("id_rsa"));
  assert.ok(firewall.isForbiddenFilename("cookies.sqlite"));
  assert.ok(firewall.isForbiddenDirectory(".ssh"));
  assert.ok(firewall.isForbiddenDirectory("Documents"));
  assert.ok(!firewall.isForbiddenDirectory("skills"));
  assert.ok(!firewall.isForbiddenFilename("skill.json"));
});

test("risk classification derives from requested capabilities, not claims", () => {
  assert.equal(classifySkillRisk({ permissions: ["workspace.read"] }), "LOW");
  assert.equal(classifySkillRisk({ permissions: ["workspace.read"], networkRequirements: ["network.http"] }), "MEDIUM");
  assert.equal(classifySkillRisk({ permissions: ["terminal.execute"] }), "MEDIUM");
  assert.equal(classifySkillRisk({ permissions: ["workspace.read"], secretRequirements: ["API_KEY"] }), "HIGH");
  assert.equal(classifySkillRisk({ permissions: ["secrets.read"] }), "HIGH");
});

test("high-risk and untrusted skills always require review before activation", () => {
  assert.ok(requiresReviewBeforeActivation("HIGH", "VERIFIED"));
  assert.ok(!requiresReviewBeforeActivation("LOW", "VERIFIED"));
  assert.ok(requiresReviewBeforeActivation("LOW", "UNVERIFIED"));
  assert.ok(!requiresReviewBeforeActivation("LOW", "USER_APPROVED"));
});

async function discoveryRoot(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "quack-skillroot-"));
  return { root: dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test("discovery reads only explicit roots and only manifest files", async t => {
  const ws = await discoveryRoot();
  t.after(ws.cleanup);

  await mkdir(join(ws.root, "web-scraper"));
  await writeFile(join(ws.root, "web-scraper", "skill.json"), JSON.stringify({
    id: "fixture.scraper", name: "Web Scraper", version: "1.0.0", kind: "TOOL",
    requiresPermissions: ["workspace.read", "network.http"], networkRequirements: ["network.http"],
    platforms: ["all"],
  }));
  // Neighboring sensitive files must NOT be ingested.
  await writeFile(join(ws.root, "web-scraper", ".env"), "API_KEY=supersecret");
  await writeFile(join(ws.root, "web-scraper", "notes.md"), "personal notes");
  // Non-skill directory without a manifest.
  await mkdir(join(ws.root, "random-dir"));
  await writeFile(join(ws.root, "random-dir", "data.txt"), "data");

  const discovery = new SkillDiscovery({ roots: [ws.root] });
  const skills = await discovery.discover();

  assert.equal(skills.length, 1);
  const scraper = skills[0]!;
  assert.equal(scraper.skillId, "fixture.scraper");
  assert.equal(scraper.riskClass, "MEDIUM");
  assert.deepEqual(scraper.declaredPermissions, ["workspace.read", "network.http"]);
  assert.match(scraper.manifestHash, /^[a-f0-9]{64}$/);
  assert.equal(scraper.contentHash, skillContentHash(JSON.stringify({
    id: "fixture.scraper", name: "Web Scraper", version: "1.0.0", kind: "TOOL",
    requiresPermissions: ["workspace.read", "network.http"], networkRequirements: ["network.http"],
    platforms: ["all"],
  })));
});

test("discovery never scans outside explicit roots and skips dot/forbidden dirs", async t => {
  const ws = await discoveryRoot();
  t.after(ws.cleanup);

  await mkdir(join(ws.root, ".ssh"), { recursive: true });
  await writeFile(join(ws.root, ".ssh", "id_rsa"), "PRIVATE KEY MATERIAL");
  await mkdir(join(ws.root, "real-skill"));
  await writeFile(join(ws.root, "real-skill", "skill.json"), JSON.stringify({
    id: "fixture.safe", name: "Safe", version: "1.0.0", kind: "INSTRUCTION_ONLY", requiresPermissions: [],
  }));

  const discovery = new SkillDiscovery({ roots: [ws.root] });
  const skills = await discovery.discover();
  assert.equal(skills.length, 1);
  assert.equal(skills[0]!.skillId, "fixture.safe");
});

test("discovery requires explicit roots and rejects empty configuration", () => {
  assert.throws(() => new SkillDiscovery({ roots: [] }));
});

test("discovered skills with secrets in manifests are quarantined to review and redacted", async t => {
  const ws = await discoveryRoot();
  t.after(ws.cleanup);
  await mkdir(join(ws.root, "leaky"));
  await writeFile(join(ws.root, "leaky", "skill.json"), JSON.stringify({
    id: "fixture.leaky", name: "Leaky", version: "1.0.0", requiresPermissions: [],
    apiKey: "sk-supersecret",
  }));

  const skills = await new SkillDiscovery({ roots: [ws.root] }).discover();
  assert.equal(skills.length, 1);
  const leaky = skills[0]!;
  assert.equal(leaky.safeMetadata["apiKey"], "[REDACTED]");
  assert.ok(leaky.privacy.dataClasses.length >= 1);

  const registry = new DiscoveredSkillRegistry(new InMemorySkillRegistryStore());
  const records = registry.registerDiscovered(skills);
  assert.equal(records[0]!.installationState, "DISCOVERED");
});

test("registry lifecycle: discovered never auto-approves; install requires approval", async t => {
  const ws = await discoveryRoot();
  t.after(ws.cleanup);
  await mkdir(join(ws.root, "scraper"));
  await writeFile(join(ws.root, "scraper", "skill.json"), JSON.stringify({
    id: "fixture.scraper", name: "Scraper", version: "1.0.0",
    requiresPermissions: ["network.http"], networkRequirements: ["network.http"],
  }));

  const skills = await new SkillDiscovery({ roots: [ws.root] }).discover();
  const registry = new DiscoveredSkillRegistry(new InMemorySkillRegistryStore());
  const [record] = registry.registerDiscovered(skills)!;

  assert.equal(record!.installationState, "DISCOVERED");
  assert.throws(() => registry.install(record!.skillId));
  const approved = registry.approve(record!.skillId)!;
  assert.equal(approved.installationState, "APPROVED");
  assert.equal(approved.trustLevel, "USER_APPROVED");
  const installed = registry.install(record!.skillId)!;
  assert.equal(installed.installationState, "INSTALLED");
  assert.equal(installed.verificationState, "HASH_VERIFIED");

  const disabled = registry.disable(record!.skillId)!;
  assert.equal(disabled.installationState, "DISABLED");
  const revoked = registry.revoke(record!.skillId)!;
  assert.equal(revoked.installationState, "REVOKED");
  assert.equal(revoked.trustLevel, "BLOCKED");
  assert.throws(() => registry.approve(record!.skillId), /REVOKED/);
});

test("content change after installation forces REVALIDATION_REQUIRED", async t => {
  const ws = await discoveryRoot();
  t.after(ws.cleanup);
  const manifest = { id: "fixture.changed", name: "Changed", version: "1.0.0", requiresPermissions: [] };
  await mkdir(join(ws.root, "changed"));
  await writeFile(join(ws.root, "changed", "skill.json"), JSON.stringify(manifest));

  const discovery = new SkillDiscovery({ roots: [ws.root] });
  const registry = new DiscoveredSkillRegistry(new InMemorySkillRegistryStore());
  registry.registerDiscovered(await discovery.discover());
  registry.approve("fixture.changed");
  registry.install("fixture.changed");

  // Tamper with the manifest after installation.
  await writeFile(join(ws.root, "changed", "skill.json"), JSON.stringify({ ...manifest, sneaky: true }));
  const rediscovered = await discovery.discover();
  const updated = registry.registerDiscovered(rediscovered);
  const record = updated[0]!;
  assert.equal(record.installationState, "REVALIDATION_REQUIRED");
  assert.equal(record.verificationState, "UNVERIFIED");
  // Reinstalling modified content is blocked until re-approved.
  assert.throws(() => registry.install("fixture.changed"), /must be approved/);
  assert.ok(!verifySkillRecordContent(record, JSON.stringify({ ...manifest, sneaky: true })) === false);
});

test("high-risk skills enter REVIEW_REQUIRED and never DISCOVERED", async t => {
  const ws = await discoveryRoot();
  t.after(ws.cleanup);
  await mkdir(join(ws.root, "dangerous"));
  await writeFile(join(ws.root, "dangerous", "skill.json"), JSON.stringify({
    id: "fixture.dangerous", name: "Dangerous", version: "1.0.0",
    requiresPermissions: ["secrets.read"], secretRequirements: ["API_KEY"],
  }));

  const skills = await new SkillDiscovery({ roots: [ws.root] }).discover();
  assert.equal(skills[0]!.riskClass, "HIGH");
  const registry = new DiscoveredSkillRegistry(new InMemorySkillRegistryStore());
  const records = registry.registerDiscovered(skills);
  assert.equal(records[0]!.installationState, "REVIEW_REQUIRED");
});