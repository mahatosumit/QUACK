/**
 * Phase 6 CLI command implementations. Every command is a THIN UI layer
 * over the canonical system — no second runtime, no bypass:
 *
 *   quack command → createQuackSystem → QuackRuntime → CapabilityBroker
 *   → governed execution
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createQuackSystem } from "../distributions/swe-system.js";
import { ensureQuackHome, quackHome, quackHomeLayout } from "./paths.js";
import { loadCliConfig, defaultConfigFilePath, type CliConfig } from "./config.js";

export interface CommandContext {
  readonly json: boolean;
  readonly config: CliConfig;
}

function out(context: CommandContext, value: unknown): void {
  console.log(JSON.stringify(value, null, context.json ? 2 : 0));
}

// ---------------------------------------------------------------------------
// quack init
// ---------------------------------------------------------------------------

export async function commandInit(context: CommandContext): Promise<number> {
  const layout = ensureQuackHome(quackHome());
  // Write the default config file only when absent — never clobber user edits.
  const configFile = defaultConfigFilePath(layout);
  if (!existsSync(configFile)) {
    mkdirSync(layout.config, { recursive: true });
    writeFileSync(configFile, JSON.stringify({
      dataDir: layout.data,
      logLevel: "info",
      skillRoots: [layout.skills],
      ownershipLeaseMs: 30_000,
    }, null, 2) + "\n", "utf8");
  }
  if (!context.json) {
    console.log(`Initialized QUACK home: ${layout.root}`);
    console.log(`  config: ${layout.config}`);
    console.log(`  data:   ${layout.data}`);
    console.log(`  skills: ${layout.skills}`);
    console.log(`Next: quack doctor`);
  } else {
    out(context, { initialized: true, home: layout.root, configFile,
      directories: { config: layout.config, data: layout.data, logs: layout.logs,
        skills: layout.skills, cache: layout.cache, models: layout.models, runtime: layout.runtime } });
  }
  return 0;
}

// ---------------------------------------------------------------------------
// quack status
// ---------------------------------------------------------------------------

export async function commandStatus(context: CommandContext): Promise<number> {
  const system = createQuackSystem({ dataDir: context.config.dataDir, workspaceRoot: context.config.workspaceRoot });
  try {
    const missions = system.storage.missions.list();
    const tasks = await system.storage.tasks.list();
    const skills = system.skills.getAll();
    const packages = system.skillPackages.listInstalled();
    const pending = tasks.filter(task => task.status === "running" || task.status === "planned");
    const body = {
      version: packageVersion(),
      home: quackHome(),
      dataDir: context.config.dataDir,
      workspaceRoot: context.config.workspaceRoot,
      missions: missions.length,
      tasks: { total: tasks.length, running: pending.length },
      skills: { registered: skills.length, packages: packages.length },
    };
    if (context.json) out(context, body);
    else {
      console.log(`QUACK v${body.version}`);
      console.log(`  data dir:    ${body.dataDir}`);
      console.log(`  missions:    ${body.missions}`);
      console.log(`  tasks:       ${body.tasks.total} (${body.tasks.running} active)`);
      console.log(`  skills:      ${body.skills.registered} registered, ${body.skills.packages} package(s)`);
      if (pending.length > 0) {
        console.log(`  resumable:  ${pending.map(task => task.id).join(", ")}`);
      }
    }
    await system.events.drain();
    return 0;
  } catch (error) {
    if (context.json) out(context, { error: String(error) });
    else console.error("Status failed:", error instanceof Error ? error.message : String(error));
    return 1;
  }
}

// ---------------------------------------------------------------------------
// quack run <goal>
// ---------------------------------------------------------------------------

export async function commandRun(context: CommandContext, goal: string): Promise<number> {
  if (!goal.trim()) {
    if (!context.json) console.error("quack run requires a goal: quack run \"<goal>\"");
    return 2;
  }
  const system = createQuackSystem({ dataDir: context.config.dataDir, workspaceRoot: context.config.workspaceRoot });
  try {
    const result = await system.runtime.submitGoal(goal, "cli", { origin: "cli" });
    if (!result.ok) {
      if (context.json) out(context, { ok: false, error: result.error.message });
      else console.error("Mission failed:", result.error.message);
      return 1;
    }
    const task = result.data;
    const loopResult = system.runtime.getLoopResult(task.id);
    const completed = task.status === "completed";
    if (context.json) {
      out(context, { ok: completed, taskId: task.id, status: task.status,
        summary: (task.result as { summary?: string } | undefined)?.summary ?? null,
        receipt: ((task.result as { receipt?: unknown } | undefined)?.receipt as object | undefined) ?? null });
    } else if (completed) {
      console.log(`Mission completed: ${(task.result as { summary?: string } | undefined)?.summary ?? task.id}`);
      const receipt = (task.result as { receipt?: { digest?: string } } | undefined)?.receipt;
      if (receipt?.digest) console.log(`  receipt: ${receipt.digest}`);
    } else {
      console.error(`Mission ended in status: ${task.status}`);
    }
    await system.events.drain();
    return completed ? 0 : 1;
  } catch (error) {
    if (context.json) out(context, { ok: false, error: String(error) });
    else console.error("Mission failed:", error instanceof Error ? error.message : String(error));
    return 1;
  }
}

// ---------------------------------------------------------------------------
// quack resume <mission-id>
// ---------------------------------------------------------------------------

export async function commandResume(context: CommandContext, missionId: string): Promise<number> {
  if (!missionId.trim()) {
    if (!context.json) console.error("quack resume requires a mission/task id.");
    return 2;
  }
  const system = createQuackSystem({ dataDir: context.config.dataDir, workspaceRoot: context.config.workspaceRoot });
  try {
    const result = await system.runtime.resumeMission(missionId);
    if (!result.ok) {
      if (context.json) out(context, { ok: false, error: result.error.message, code: result.error.code });
      else console.error(`Resume rejected (${result.error.code}): ${result.error.message}`);
      return result.error.code === "recovery.ownership_conflict" ? 1 : 1;
    }
    const task = result.data;
    const completed = task.status === "completed";
    if (context.json) out(context, { ok: completed, taskId: task.id, status: task.status });
    else console.log(completed ? `Mission resumed and completed: ${task.id}` : `Resume returned status: ${task.status}`);
    await system.events.drain();
    return completed ? 0 : 1;
  } catch (error) {
    if (context.json) out(context, { ok: false, error: String(error) });
    else console.error("Resume failed:", error instanceof Error ? error.message : String(error));
    return 1;
  }
}

// ---------------------------------------------------------------------------
// quack skills search <query>
// ---------------------------------------------------------------------------

export async function commandSkillsSearch(context: CommandContext, query: string): Promise<number> {
  if (!query.trim()) {
    if (!context.json) console.error("quack skills search requires a query.");
    return 2;
  }
  const { SkillDiscovery } = await import("../skills/discovery/discovery.js");
  const discovery = new SkillDiscovery({ roots: [...context.config.skillRoots] });
  const found = await discovery.discover();
  const needle = query.toLowerCase();
  const matches = found.filter(record =>
    record.skillId.toLowerCase().includes(needle) || record.name.toLowerCase().includes(needle));
  if (context.json) out(context, { query, roots: context.config.skillRoots, matches });
  else {
    if (matches.length === 0) console.log(`No skills matching "${query}" in configured roots.`);
    for (const match of matches) console.log(`${match.skillId}  risk=${match.riskClass}  ${match.name}`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// quack instructions [--mission <id>] (P8.8) — inspect governed-instruction records
// ---------------------------------------------------------------------------

/**
 * P8.8 instruction inspection: lists metadata-only governed-instruction
 * dispatch records (P8.6) from the EXISTING trace repository. No new
 * store, no content — records carry identity, census, budget, and defense
 * facts only. `--mission <id>` filters through the existing trace-by-
 * mission lookup; `--json` emits machine-readable output. Records that
 * fail fail-closed validation are reported as invalid and never silently
 * rendered as if trustworthy.
 */
export async function commandInstructions(context: CommandContext, missionId?: string): Promise<number> {
  const system = createQuackSystem({ dataDir: context.config.dataDir, workspaceRoot: context.config.workspaceRoot });
  try {
    const traces = await system.storage.traces.list(missionId ? { missionId } : undefined);
    const { parseInstructionRecord } = await import("../instruction/records.js");

    const valid: import("../instruction/records.js").GovernedInstructionRecord[] = [];
    let invalidCount = 0;
    for (const trace of traces) {
      for (const raw of trace.instruction ?? []) {
        const parsed = parseInstructionRecord(raw as unknown as Record<string, unknown>);
        if (parsed.ok) valid.push(parsed.data);
        else invalidCount += 1;
      }
    }

    if (context.json) {
      out(context, {
        missionId: missionId ?? null,
        traceCount: traces.length,
        recordCount: valid.length,
        invalidRecordCount: invalidCount,
        records: valid.map((record) => ({
          recordId: record.recordId,
          missionId: record.missionId,
          ...(record.taskId ? { taskId: record.taskId } : {}),
          digest: record.digest,
          outcome: record.outcome,
          ...(record.errorCode ? { errorCode: record.errorCode } : {}),
          totalItems: record.totalItems,
          omittedItemCount: record.omittedItemCount,
          withinBudget: record.withinBudget,
          injectionFlagCount: record.injectionFlagCount,
          layerCensus: record.layerCensus,
          dispatchedAt: record.dispatchedAt,
        })),
      });
    } else {
      console.log(`Governed instruction dispatches${missionId ? ` for mission ${missionId}` : ""} (from ${traces.length} trace(s)):`);
      if (valid.length === 0 && invalidCount === 0) {
        console.log("  No instruction dispatch records stored yet.");
        console.log("  Records appear when missions dispatch composed instructions through the governed runtime.");
      }
      for (const record of valid) {
        console.log(`  ${record.dispatchedAt}  ${record.missionId}${record.taskId ? ` / ${record.taskId}` : ""}  ${record.outcome.padEnd(14)} digest ${record.digest.slice(0, 12)}…  ${record.totalItems} item(s), ${record.omittedItemCount} omitted, ${record.injectionFlagCount} flag(s)${record.errorCode ? `  [${record.errorCode}]` : ""}`);
      }
      if (invalidCount > 0) console.log(`  ${invalidCount} stored record(s) failed validation and were excluded — inspect the data directory for tampering.`);
    }
    await system.events.drain();
    return 0;
  } catch (error) {
    if (context.json) out(context, { error: String(error) });
    else console.error("Instructions inspection failed:", error instanceof Error ? error.message : String(error));
    return 1;
  }
}

// ---------------------------------------------------------------------------
// quack memory list|inspect|search|delete (P9.24) — governed semantic memory inspection
// ---------------------------------------------------------------------------

/**
 * P9.24 memory inspection: every command operates on the canonical
 * semantic-memory store through the SAME admission/authorization path as
 * production (the service authorize hook resolves memory.read/write via
 * the capability broker). Exit codes: 0 success, 1 operational failure,
 * 2 usage error, 3 not found / access denied (fail-closed, meaningful).
 */
export async function commandMemory(
  context: CommandContext,
  action: "list" | "inspect" | "search" | "delete",
  target?: string,
): Promise<number> {
  const system = createQuackSystem({ dataDir: context.config.dataDir, workspaceRoot: context.config.workspaceRoot });
  const memory = system.semanticMemory;
  try {
    await memory.recover();
    if (action === "list") {
      const records = await memory.list();
      if (context.json) {
        out(context, {
          recordCount: records.length,
          records: records.map(recordView),
        });
      } else {
        console.log(`Semantic memory records (${records.length}):`);
        if (records.length === 0) console.log("  No semantic memory stored yet. Records appear when an authorized actor remembers content explicitly.");
        for (const record of records) {
          console.log(`  ${record.memoryId}  ${record.scope.padEnd(9)} ${record.owner.padEnd(12)} ${record.provenance.sourceKind.padEnd(10)} ${record.contentHash.slice(0, 12)}… ${record.embedding ? "embedded" : "plain"}`);
        }
      }
      await system.events.drain();
      return 0;
    }
    if (action === "inspect") {
      if (!target) { console.error("quack memory inspect requires a memory id."); return 2; }
      const record = await memory.inspect(target);
      if (!record.ok) {
        if (context.json) out(context, { error: record.error.code });
        else console.error(`Memory ${target} not found.`);
        return 3;
      }
      out(context, { record: recordView(record.data) });
      await system.events.drain();
      return 0;
    }
    if (action === "delete") {
      if (!target) { console.error("quack memory delete requires a memory id."); return 2; }
      const result = await memory.forget(target, { actor: "cli" });
      if (!result.ok) {
        if (context.json) out(context, { error: result.error.code });
        else console.error(`Memory ${target} could not be deleted: ${result.error.message}`);
        return 3;
      }
      if (context.json) out(context, { memoryId: target, deleted: result.data.deleted, sweptChunks: result.data.sweptChunks });
      else console.log(result.data.deleted ? `Deleted ${target} (${result.data.sweptChunks} index chunk(s) swept).` : `Memory ${target} was already absent.`);
      await system.events.drain();
      return 0;
    }
    // search
    if (!target) { console.error("quack memory search requires a query string."); return 2; }
    const result = await memory.recall({
      text: target,
      scope: "global",
      owner: "cli",
      limit: 20,
      context: { actor: "cli" },
    });
    if (!result.ok) {
      if (context.json) out(context, { error: result.error.code });
      else console.error(`Semantic search unavailable: ${result.error.message}`);
      return 1;
    }
    if (context.json) {
      out(context, {
        query: target,
        hitCount: result.data.hits.length,
        hits: result.data.hits.map((hit) => ({ memoryId: hit.memory.memoryId, score: hit.score, matchedChunkId: hit.matchedChunkId, scope: hit.memory.scope, owner: hit.memory.owner })),
      });
    } else {
      console.log(`Semantic search for "${target}" (${result.data.hits.length} hit(s)):`);
      if (result.data.hits.length === 0) console.log("  No semantically relevant memory in the global scope.");
      for (const hit of result.data.hits) {
        console.log(`  ${hit.memory.memoryId}  score ${hit.score.toFixed(3)}  ${hit.memory.scope}/${hit.memory.owner}`);
      }
    }
    await system.events.drain();
    return 0;
  } catch (error) {
    if (context.json) out(context, { error: String(error) });
    else console.error("Memory command failed:", error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/** Metadata + bounded content preview for CLI output (no secrets by construction; admission rejected them). */
function recordView(record: import("../memory/semantic/records.js").SemanticMemoryRecord): Record<string, unknown> {
  return {
    memoryId: record.memoryId,
    scope: record.scope,
    owner: record.owner,
    contentPreview: record.content.length > 200 ? `${record.content.slice(0, 200)}...` : record.content,
    contentHash: record.contentHash,
    provenance: record.provenance,
    lifecycle: record.lifecycle,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    admission: record.admission,
    embedding: record.embedding ? { providerId: record.embedding.providerId, model: record.embedding.model, embeddingVersion: record.embedding.embeddingVersion, dimensions: record.embedding.dimensions } : null,
  };
}

// ---------------------------------------------------------------------------
// quack provider list|doctor|test <id>
// ---------------------------------------------------------------------------

/** Build the provider validation service over the canonical system. */
async function providerService(dataDir: string) {
  const { createQuackSystem } = await import("../distributions/swe-system.js");
  const { ProviderValidationService } = await import("../providers/validation.js");
  const { JsonFileProviderHealthStore } = await import("../providers/health.js");
  const { join } = await import("node:path");
  const system = createQuackSystem({ dataDir });
  const service = new ProviderValidationService({
    registry: system.providers,
    healthStore: new JsonFileProviderHealthStore(join(dataDir, "providers", "health.json")),
    credentialEnvFor: (providerId) => {
      const kernel = system.providerKernel.get(providerId);
      return kernel?.metadata().credentialEnvironmentVariables ?? [];
    },
    });
  return { system, service };
}

export async function commandProviderList(context: CommandContext): Promise<number> {
  const { system, service } = await providerService(context.config.dataDir);
  try {
    const entries = service.list();
    if (context.json) out(context, { providers: entries });
    else {
      if (entries.length === 0) console.log("No providers registered.");
      for (const entry of entries) {
        console.log(`${entry.providerId}  ${entry.configured ? "configured" : "missing credentials"}${entry.credentialEnv.length ? `  [${entry.credentialEnv.join(", ")}]` : ""}`);
      }
    }
    await system.events.drain();
    return 0;
  } catch (error) {
    if (context.json) out(context, { error: String(error) });
    else console.error("Provider list failed:", error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export async function commandProviderDoctor(context: CommandContext): Promise<number> {
  const { system, service } = await providerService(context.config.dataDir);
  try {
    const reports = await service.doctor();
    const allHealthy = reports.every(report => report.healthy);
    if (context.json) out(context, { providers: reports, allHealthy });
    else {
      for (const report of reports) {
        console.log(`[${report.healthy ? "healthy" : "unhealthy"}] ${report.providerId}: ${report.message}`);
        if (report.missingCredentials.length > 0) console.log(`  missing credentials: ${report.missingCredentials.join(", ")}`);
      }
      console.log(allHealthy ? "All providers healthy." : "One or more providers are unhealthy.");
    }
    await system.events.drain();
    return allHealthy ? 0 : 1;
  } catch (error) {
    if (context.json) out(context, { error: String(error) });
    else console.error("Provider doctor failed:", error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export async function commandProviderTest(context: CommandContext, providerId: string): Promise<number> {
  if (!providerId.trim()) {
    if (!context.json) console.error("quack provider test requires a provider id (see: quack provider list).");
    return 2;
  }
  const { system, service } = await providerService(context.config.dataDir);
  try {
    const known = service.list().some(entry => entry.providerId === providerId);
    const report = await service.test(providerId);
    if (!known && !report.healthy && report.message.includes("not registered")) {
      if (context.json) out(context, { ok: false, error: report.message });
      else console.error(report.message);
      return 2;
    }
    if (context.json) out(context, report);
    else {
      console.log(`[${report.healthy ? "healthy" : "unhealthy"}] ${report.providerId}: ${report.message}`);
      if (report.missingCredentials.length > 0) console.log(`missing credentials: ${report.missingCredentials.join(", ")}`);
    }
    await system.events.drain();
    return report.healthy ? 0 : 1;
  } catch (error) {
    if (context.json) out(context, { error: String(error) });
    else console.error("Provider test failed:", error instanceof Error ? error.message : String(error));
    return 1;
  }
}

// ---------------------------------------------------------------------------
// quack config [list]
// ---------------------------------------------------------------------------

export async function commandConfig(context: CommandContext): Promise<number> {
  const layout = quackHomeLayout(quackHome());
  const configFile = context.config.configFile ?? defaultConfigFilePath(layout);
  const effective = context.config;
  const body = {
    configFile,
    configExists: existsSync(configFile),
    effective: {
      dataDir: effective.dataDir,
      workspaceRoot: effective.workspaceRoot,
      logLevel: effective.logLevel,
      skillRoots: effective.skillRoots,
      ownershipLeaseMs: effective.ownershipLeaseMs,
    },
    priority: ["cli", "environment", "config-file", "default"],
    envAllowlist: ["QUACK_HOME", "QUACK_DATA_DIR", "QUACK_WORKSPACE_ROOT", "QUACK_LOG_LEVEL", "QUACK_SKILL_ROOTS", "QUACK_OWNERSHIP_LEASE_MS"],
  };
  if (context.json) out(context, body);
  else {
    console.log(`config file: ${body.configFile}${body.configExists ? "" : " (not created yet — run quack init)"}`);
    console.log(`data dir:         ${effective.dataDir}`);
    console.log(`workspace root:   ${effective.workspaceRoot}`);
    console.log(`log level:        ${effective.logLevel}`);
    console.log(`skill roots:      ${effective.skillRoots.join(", ")}`);
    console.log(`ownership lease:  ${effective.ownershipLeaseMs} ms`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// quack update
// ---------------------------------------------------------------------------

export async function commandUpdate(context: CommandContext): Promise<number> {
  const installed = packageVersion();
  const latest = await latestNpmVersion();
  if (context.json) {
    out(context, { installed, latest, updateAvailable: latest !== undefined && latest !== installed, dataPreserved: quackHome() });
    return 0;
  }
  console.log(`Installed: ${installed}`);
  if (latest === undefined) {
    console.log("Latest version: unknown (registry unreachable or package unpublished).");
    return 0;
  }
  console.log(`Latest:    ${latest}`);
  if (latest === installed) console.log("QUACK is up to date.");
  else console.log(`Update available. Run: npm install -g @quack/os@${latest}\nUser data (${quackHome()}) is never touched by updates.`);
  return 0;
}

// ---------------------------------------------------------------------------
// quack uninstall
// ---------------------------------------------------------------------------

export async function commandUninstall(context: CommandContext, removeData: boolean): Promise<number> {
  const home = quackHome();
  if (!context.json) {
    console.log(`QUACK CLI is managed by npm: npm uninstall -g @quack/os`);
    console.log(`User data lives in: ${home}`);
  }
  if (!removeData) {
    if (context.json) out(context, { uninstalled: false, dataPreserved: true, home, hint: "re-run with --purge-data to remove user data" });
    else console.log("User data preserved. To also remove it: quack uninstall --purge-data");
    return 0;
  }
  // Purge ONLY the default home. A custom QUACK_HOME is never removed
  // automatically — the user removes it manually.
  if (home === join(homedir(), ".quack")) {
    rmSync(home, { recursive: true, force: true });
    if (context.json) out(context, { uninstalled: true, removedData: home });
    else console.log(`Removed user data: ${home}`);
    return 0;
  }
  if (context.json) out(context, { uninstalled: false, error: "refusing to remove custom QUACK_HOME" });
  else console.error("Refusing to purge a custom QUACK_HOME automatically — remove it manually.");
  return 1;
}

// ---------------------------------------------------------------------------
// quack skill create <id> (Phase 7F) — Build Your Own Skill generator
// ---------------------------------------------------------------------------

/**
 * Generated skill layout. Both formats are written:
 *   - Human contract (spec): skill.yaml, instructions.md, permissions.yaml, tests/, README.md
 *   - Machine contract (governed installer): manifest.json, workflow.json
 * The skill is NOT activated. Activation requires explicit
 * `quack skills install <path>` + `quack skills enable <id>` (validation +
 * permission review + human approval through the canonical workflow).
 */
export async function commandSkillCreate(context: CommandContext, skillId: string): Promise<number> {
  const raw = skillId.trim();
  if (!raw) {
    if (!context.json) console.error("quack skill create requires a skill id: quack skill create robotics-researcher");
    return 2;
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(raw)) {
    if (!context.json) console.error("Skill id must be kebab/dot/underscore text (e.g. robotics-researcher).");
    return 2;
  }
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");

  // Default output: the first configured skill root (the QUACK home skills
  // directory), so created skills are discoverable but never auto-installed.
  const targetRoot = context.config.skillRoots[0];
  if (!targetRoot) {
    if (!context.json) console.error("No skill root configured — run `quack init` first.");
    return 1;
  }
  const packageRoot = join(targetRoot, raw);
  mkdirSync(join(packageRoot, "tests"), { recursive: true });

  const riskDeclaration = [
    "# Risk declaration (required before activation)",
    "",
    "risk-class: LOW            # LOW | MEDIUM | HIGH — derived from requirements below",
    "network: none              # list required endpoints if any",
    "secrets: none              # list required secret names if any (SecretProvider only)",
    "filesystem: none           # read/write scope, e.g. workspace-read-only",
    "execution: declarative     # declarative | tool-port — never arbitrary code",
    "",
    "Reviewer: verify each line above against instructions.md and manifest.json",
    "before running `quack skills install`.",
  ].join("\n");

  writeFileSync(join(packageRoot, "skill.yaml"), [
    `id: ${raw}`,
    "name: " + raw.split(/[-._]/).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" "),
    "version: 0.1.0",
    `description: Describe what ${raw} does and when it should be selected.`,
    "author: you",
    "category: custom",
    "tags: []                   # selector tokens — goals matching these select this skill",
    "kind: INSTRUCTION_ONLY     # INSTRUCTION_ONLY | WORKFLOW | TOOL | MCP",
    "trust-level: community",
    "created-by: quack skill create",
  ].join("\n") + "\n", "utf8");

  writeFileSync(join(packageRoot, "instructions.md"), [
    `# ${raw}`,
    "",
    "## Purpose",
    "",
    "State the single purpose of this skill.",
    "",
    "## Instructions",
    "",
    "- Replace these lines with the operating instructions.",
    "- Instructions are guidance, not executable code.",
    "- Never place secrets in this file.",
    "",
    "## Examples",
    "",
    "- Goal that should select this skill: \"<example goal>\"",
  ].join("\n") + "\n", "utf8");

  writeFileSync(join(packageRoot, "permissions.yaml"), [
    `# ${raw} permission declaration — reviewed before activation`,
    "permissions: []            # e.g. workspace.read; every entry needs a reason",
    "tools: [core.workspace.list-files]",
    "network: none",
    "secrets: none",
    "escalation: denied         # generated skills start with no escalation path",
  ].join("\n") + "\n", "utf8");

  writeFileSync(join(packageRoot, "risk-declaration.yaml"), riskDeclaration + "\n", "utf8");

  // Machine contract: validates through the real governed installer.
  writeFileSync(join(packageRoot, "manifest.json"), JSON.stringify({
    id: raw,
    name: raw.split(/[-._]/).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" "),
    version: "0.1.0",
    description: `Describe what ${raw} does and when it should be selected.`,
    author: "you",
    trustLevel: "community",
    requiredCapabilities: ["permission.workspace.read"],
    allowedTools: ["core.workspace.list-files"],
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    executionLimits: { timeoutMs: 30_000, maxIterations: 1, maxToolCalls: 1, maxRetriesPerStep: 0 },
    category: "custom",
    tags: ["custom"],
  }, null, 2) + "\n", "utf8");
  writeFileSync(join(packageRoot, "workflow.json"), JSON.stringify({
    steps: [
      {
        id: "ground",
        description: "Ground the skill instructions in the workspace.",
        requiredTools: ["core.workspace.list-files"],
        toolInvocations: [{ toolId: "core.workspace.list-files", input: { path: ".", depth: 1 }, reason: "Read-only grounding step." }],
        timeoutMs: 10_000,
      },
    ],
  }, null, 2) + "\n", "utf8");

  writeFileSync(join(packageRoot, "tests", "smoke.test.json"), JSON.stringify({
    skillId: raw,
    goal: `example goal that selects ${raw}`,
    expect: { selected: true, lifecycle: "inactive-until-enabled" },
  }, null, 2) + "\n", "utf8");

  writeFileSync(join(packageRoot, "README.md"), [
    `# ${raw}`,
    "",
    "Generated by `quack skill create`. Not installed, not enabled, not active.",
    "",
    "## Lifecycle",
    "",
    "1. Edit skill.yaml, instructions.md, permissions.yaml, workflow.json.",
    "2. Fill risk-declaration.yaml — every line must be true.",
    "3. Review permissions: every entry needs a reason; least authority.",
    "4. Validate + install (human approval happens here):",
    "",
    "   ```",
    `   quack skills install ${packageRoot}`,
    `   quack skills enable ${raw}`,
    "   ```",
    "",
    "Activation always flows through CLI → QuackRuntime → Planner →",
    "CapabilityBroker → governed tool execution → evidence → verification →",
    "receipt. Generated skills never receive elevated authority by default.",
  ].join("\n") + "\n", "utf8");

  if (context.json) {
    out(context, { created: true, skillId: raw, packageRoot, activated: false, nextSteps: ["edit files", "quack skills install " + packageRoot, "quack skills enable " + raw] });
  } else {
    console.log(`Created skill scaffold: ${packageRoot}`);
    console.log("  skill.yaml, instructions.md, permissions.yaml, risk-declaration.yaml,");
    console.log("  manifest.json, workflow.json, tests/, README.md");
    console.log("Not activated. Install + enable explicitly after review:");
    console.log(`  quack skills install ${packageRoot}`);
    console.log(`  quack skills enable ${raw}`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// quack personas (Phase 7E) — list persona definitions
// ---------------------------------------------------------------------------

export async function commandPersonas(context: CommandContext): Promise<number> {
  const { PERSONAS } = await import("../agents/personas/personas.js");
  if (context.json) {
    out(context, { personas: PERSONAS });
    return 0;
  }
  for (const persona of PERSONAS) {
    console.log(`${persona.id.padEnd(18)} ${persona.name.padEnd(18)} ${persona.focus}`);
    console.log(`                   reasoning: ${persona.reasoningStyle.join(", ")}`);
    console.log(`                   planning:  ${persona.planningPreference.join(", ")}`);
  }
  console.log("\nPersonas are style-only: they never grant permissions, tools, or trust.");
  return 0;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export function packageVersion(): string {
  try {
    // dist/cli/commands.js → dist/ → package root.
    const path = join(import.meta.dirname, "..", "..", "package.json");
    const version: unknown = JSON.parse(readFileSync(path, "utf8")).version;
    return typeof version === "string" ? version : "unknown";
  } catch {
    return "unknown";
  }
}

async function latestNpmVersion(): Promise<string | undefined> {
  // Read-only registry query via argv exec (platform process policy: no
  // shell). npm is a .cmd shim on Windows, so resolve the node-distributed
  // npm-cli.js exactly like resolveNodeCliArgv does for npx.
  const { childProcessEnvironment, executeProcess } = await import("../platform/process.js");
  const { join, dirname } = await import("node:path");
  const { existsSync } = await import("node:fs");
  const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (!existsSync(npmCli)) return undefined;
  try {
    const result = await executeProcess({
      command: process.execPath, args: [npmCli, "view", "@quack/os", "version"],
      workingDirectory: homedir(),
      environment: childProcessEnvironment(), timeoutMs: 15_000,
    });
    if (result.status !== "COMPLETED" || result.exitCode !== 0) return undefined;
    return result.stdout.trim().split(/\r?\n/).at(-1)?.trim() || undefined;
  } catch {
    return undefined;
  }
}
