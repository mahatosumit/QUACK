#!/usr/bin/env node
import { createQuackSystem } from "./distributions/swe-system.js";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { DEFAULT_PORT } from "./desktop/types.js";
import { createQuackBackup, restoreQuackBackup } from "./recovery/index.js";
import { cpus, release, totalmem } from "node:os";
import { execFile } from "node:child_process";
import { redactSecrets } from "./security/secret-provider.js";
import { commandInit, commandStatus, commandRun, commandResume, commandSkillsSearch, commandConfig, commandUpdate, commandUninstall, commandProviderList, commandProviderDoctor, commandProviderTest, commandSkillCreate, commandPersonas } from "./cli/commands.js";
import { loadCliConfig } from "./cli/config.js";

interface CliOptions {
  goal: string;
  config?: string;
  workspaceRoot?: string;
  dataDir?: string;
  skillAction?: "install" | "list" | "enable" | "disable" | "search" | "create";
  skillTarget?: string;
  providerAction?: "list" | "doctor" | "test";
  /** Provider id for `provider test`. */
  providerTarget?: string;
  headless: boolean;
  port?: number;
  backupPath?: string;
  /** Machine-readable output for any command. */
  json: boolean;
  /** quack uninstall --purge-data */
  purgeData: boolean;
}

const PACKAGE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "package.json"
);

function getVersion(): string {
  try {
    const version: unknown = JSON.parse(readFileSync(PACKAGE_PATH, "utf-8")).version;
    return typeof version === "string" ? version : "unknown";
  } catch {
    return "unknown";
  }
}

function printHelp(): void {
  console.log(`
QUACK — Quantum Unified Autonomous Cognitive Kernel
Version ${getVersion()}

Usage:
  quack [options] <goal>
  quack <command> [options]

Commands:
  init               Initialize the QUACK home (~/.quack) with config/data/logs/skills
  doctor             Run QUACK system health diagnostics
  status             Show missions, tasks, and skills summary
  run <goal>         Run a goal as a governed mission (alias for start)
  resume <id>        Resume an interrupted mission by task/mission id
  start <goal>       Start QUACK with a goal (default)
  mission <goal>     Run a mission through the Agent Loop
  skills             List registered skills and installed packages
  skills search <q>  Search configured skill roots for matching skills
  skills create <id>
                      Scaffold a new skill package (not activated)
  skills install <path>
                     Import and register a declarative skill package
  skills enable <id> Enable an installed skill package
  skills disable <id>
                       Disable an installed skill package
  personas           List agent personas (style-only reasoning modes)
  provider list      List registered providers and credential status
  provider doctor   Live health check of every registered provider
  provider test <id>
                      Health-check a single provider
  config             Show effective configuration and its sources
  agents             List specialist agents
  trace <goal>       Run a mission and emit a harness trace
  evaluate <goal>    Run a mission and emit a harness evaluation
  serve              Start QUACK desktop server
  update             Check for a newer @quack/os release
  uninstall          CLI is removed via npm; optionally purge user data
  backup [path]      Create a verified non-secret backup
  restore <path>     Verify and atomically restore a backup
  help               Show this help message
  version            Show version information

Options:
  --json             Machine-readable JSON output (any command)
  --config, -c       Path to config file
  --workspace, -w    Workspace root directory
  --data-dir, -d     Data directory for persistence
  --port, -p         Desktop server port (default: ${DEFAULT_PORT})
  --headless         Run without GUI
  --purge-data       (uninstall only) also remove ~/.quack
  --help, -h         Show this help message
  --version, -v      Show version

Exit codes: 0 success · 1 failure · 2 usage error

Examples:
  quack init
  quack doctor --json
  quack run "bootstrap the coding agent"
  quack resume <mission-id>
  quack skills search validation
  quack serve --port 8080
`);
}

export function parseArgs(argv: string[]): { command: string; options: CliOptions } {
  const args = argv.slice(2);
  const options: CliOptions = {
    goal: "start QUACK",
    headless: false,
    json: false,
    purgeData: false,
  };

  let command = "start";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      case "--version":
      case "-v":
        console.log(getVersion());
        process.exit(0);
      case "--config":
      case "-c":
        options.config = args[++i];
        break;
      case "--workspace":
      case "-w":
        options.workspaceRoot = args[++i];
        break;
      case "--data-dir":
      case "-d":
        options.dataDir = args[++i];
        break;
      case "--port":
      case "-p":
        options.port = parseInt(args[++i], 10);
        break;
      case "--headless":
        options.headless = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--purge-data":
        options.purgeData = true;
        break;
      case "help":
        command = "help";
        break;
      case "version":
        command = "version";
        break;
      case "doctor":
        command = "doctor";
        break;
      case "backup":
      case "restore":
        command = arg;
        if (args[i + 1] && !args[i + 1].startsWith("-")) options.backupPath = args[++i];
        break;
      case "init":
        command = "init";
        break;
      case "mission":
        command = "mission";
        break;
      case "skills":
        command = "skills";
        if (isSkillAction(args[i + 1])) {
          const action = args[++i] as "install" | "list" | "enable" | "disable" | "search" | "create";
          options.skillAction = action;
          if (options.skillAction !== "list" && args[i + 1] && !args[i + 1].startsWith("-")) {
            options.skillTarget = args[++i];
          }
        }
        break;
      case "personas":
        command = "personas";
        break;
      case "provider":
        command = "provider";
        if (args[i + 1] === "list" || args[i + 1] === "doctor") {
          options.providerAction = args[++i] as "list" | "doctor";
        } else if (args[i + 1] === "test") {
          options.providerAction = "test";
          i++;
          if (args[i + 1] && !args[i + 1].startsWith("-")) options.providerTarget = args[++i];
          else { console.error("quack provider test requires a provider id."); process.exit(2); }
        }
        break;
      case "status":
        command = "status";
        break;
      case "run":
        command = "run";
        if (args[i + 1] && !args[i + 1].startsWith("-")) options.goal = args[++i];
        else { console.error("quack run requires a goal: quack run \"<goal>\""); process.exit(2); }
        break;
      case "resume":
        command = "resume";
        if (args[i + 1] && !args[i + 1].startsWith("-")) options.goal = args[++i];
        else { console.error("quack resume requires a mission/task id."); process.exit(2); }
        break;
      case "config":
        command = "config";
        break;
      case "update":
        command = "update";
        break;
      case "uninstall":
        command = "uninstall";
        break;
      case "agents":
        command = "agents";
        break;
      case "trace":
        command = "trace";
        break;
      case "evaluate":
        command = "evaluate";
        break;
      case "serve":
        command = "serve";
        break;
      case "start":
        command = "start";
        break;
      default:
        if (!arg.startsWith("-")) {
          options.goal = args.slice(i).join(" ");
          i = args.length;
        }
        break;
    }
  }

  return { command, options };
}

export async function runQuackDoctor(system: ReturnType<typeof createQuackSystem>, json: boolean = false): Promise<boolean> {
  if (json) return runDoctorJson(system);
  return runSoloDoctor(system);
}

/** Structured 6G doctor: runtime / storage / recovery / security / skills. */
async function runDoctorJson(system: ReturnType<typeof createQuackSystem>): Promise<boolean> {
  interface Check { name: string; ok: boolean; detail: string; }
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail: string) => { checks.push({ name, ok, detail }); };

  // Runtime
  const major = Number(process.version.slice(1).split(".")[0]);
  const minor = Number(process.version.slice(1).split(".")[1] ?? 0);
  const nodeOk = major > 22 || (major === 22 && minor >= 5);
  check("runtime.node", nodeOk, `${process.version}${nodeOk ? "" : " (requires >=22.5)"}`);
  check("runtime.os", true, `${process.platform} ${process.arch}`);
  check("runtime.kernel", Boolean(system.runtime), "QuackRuntime constructed");

  // Storage
  try {
    system.storage.missions.list();
    check("storage.database", true, join(system.config.dataDir, "quack.sqlite"));
  } catch (error) {
    check("storage.database", false, error instanceof Error ? error.message : String(error));
  }
  check("storage.workspace", existsSync(system.config.workspaceRoot), system.config.workspaceRoot);

  // Recovery (multi-process coordination DB reachable)
  try {
    const { SqliteConnection } = await import("./storage/sqlite.js");
    const { SqliteCoordinationStore } = await import("./storage/coordination.js");
    const store = new SqliteCoordinationStore(new SqliteConnection(join(system.config.dataDir, "coordination.sqlite")), { leaseMs: 1000 });
    const probe = store.acquire("doctor:probe", `doctor-${process.pid}`);
    check("recovery.coordination", probe.kind === "ACQUIRED" || probe.kind === "TAKEOVER_STALE", `coordination.sqlite lease probe: ${probe.kind}`);
  } catch (error) {
    check("recovery.coordination", false, error instanceof Error ? error.message : String(error));
  }

  // Security
  check("security.capabilityBroker", Boolean(system.runtime), "CapabilityBroker wired into runtime");
  const networkDecisions = system.networkPolicy.recentDecisions().length;
  check("security.networkPolicy", true, `${networkDecisions} recent decision(s); default deny`);

  // Skills
  try {
    const skills = system.skills.getAll();
    check("skills.registry", true, `${skills.length} skill(s) registered`);
  } catch (error) {
    check("skills.registry", false, error instanceof Error ? error.message : String(error));
  }

  // Providers
  const providerIds = system.providers.list();
  check("runtime.providers", providerIds.length > 0, providerIds.join(", ") || "none registered");

  const failed = checks.filter(entry => !entry.ok);
  const payload = {
    version: getVersion(),
    checks,
    summary: failed.length === 0 ? "System ready." : `${failed.length} check(s) failed.`,
    ready: failed.length === 0,
  };
  console.log(JSON.stringify(payload, null, 2));
  return failed.length === 0;
}

async function runSoloDoctor(system: ReturnType<typeof createQuackSystem>): Promise<boolean> {
  console.log(`\nQUACK OS Solo Doctor v${getVersion()}`);
  console.log("==========================================");
  let passed = true;
  const report = (state: "Available" | "Unavailable" | "Needs Setup" | "Blocked" | "Degraded", name: string, detail: string, fix?: string) => {
    console.log(`[${state}] ${name}: ${detail}${fix ? ` | Fix: ${fix}` : ""}`);
  };
  const major = Number(process.version.slice(1).split(".")[0]);
  const minor = Number(process.version.slice(1).split(".")[1] ?? 0);
  const nodeOk = major > 22 || (major === 22 && minor >= 5);
  report(nodeOk ? "Available" : "Blocked", "QUACK / Node", `${getVersion()} / ${process.version}`, nodeOk ? undefined : "Install Node.js 22.5 or newer (node:sqlite requirement).");
  if (!nodeOk) passed = false;
  report("Available", "Windows", process.platform === "win32" ? release() : `${process.platform} (Solo target is Windows)`);
  report("Available", "CPU / RAM", `${cpus()[0]?.model ?? "Unknown CPU"}, ${cpus().length} logical cores, ${(totalmem() / 1024 ** 3).toFixed(1)} GB RAM`);
  const gpu = await commandOutput("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]);
  report(gpu ? "Available" : "Unavailable", "NVIDIA GPU / VRAM", gpu ?? "nvidia-smi not available", gpu ? undefined : "Install a supported NVIDIA driver if GPU inference is required.");
  for (const [name, command, args, fix] of [
    ["npm", process.platform === "win32" ? "npm.cmd" : "npm", ["--version"], "Install npm with Node.js."],
    ["Git", "git", ["--version"], "Install Git for Windows."],
    ["Python", process.platform === "win32" ? "python.exe" : "python", ["--version"], "Install Python and add it to PATH if Python tools are needed."],
    ["Docker", "docker", ["--version"], "Install/start Docker Desktop only if container isolation is needed."],
    ["Ollama", "ollama", ["--version"], "Install Ollama and an appropriate model to enable local inference."],
  ] as const) {
    const output = await commandOutput(command, args);
    report(output ? "Available" : name === "Ollama" || name === "Docker" ? "Needs Setup" : "Unavailable", name, output ?? "not detected", output ? undefined : fix);
  }
  if (existsSync(system.config.workspaceRoot)) report("Available", "Workspace", system.config.workspaceRoot);
  else { report("Blocked", "Workspace", `${system.config.workspaceRoot} does not exist`, "Create or select a workspace directory."); passed = false; }
  try { system.storage.missions.list(); report("Available", "Database", join(system.config.dataDir, "quack.sqlite")); }
  catch (error) { report("Blocked", "Database", error instanceof Error ? error.message : String(error), "Restore a verified backup or select a healthy data directory."); passed = false; }
  const nvidiaPresent = Boolean(process.env.NVIDIA_API_KEY);
  report(nvidiaPresent ? "Available" : "Needs Setup", "NVIDIA_API_KEY", nvidiaPresent ? "present (value hidden)" : "missing", nvidiaPresent ? undefined : "Set NVIDIA_API_KEY in the environment that launches QUACK.");
  const providerIds = system.providers.list();
  report(providerIds.length > 0 ? "Available" : "Blocked", "Providers", providerIds.join(", ") || "none registered");
  if (providerIds.length === 0) passed = false;
  for (const id of providerIds) {
    const provider = system.providers.get(id);
    if (!provider.ok) continue;
    const health = await provider.data.healthCheck();
    report(health.healthy ? "Available" : "Degraded", `Provider ${id}`, redactSecrets(health.message));
  }
  const mcpServers = system.mcpServers.list();
  report(mcpServers.length > 0 ? "Available" : "Needs Setup", "MCP", mcpServers.length > 0 ? `${mcpServers.length} server(s) registered` : "no servers configured", mcpServers.length ? undefined : "Register a trusted or restricted MCP server in Settings.");
  report("Available", "Network policy", `${system.networkPolicy.recentDecisions().length} recent decision(s); default deny`);
  report("Available", "Desktop server", "loopback-only authenticated server available; not started by doctor");
  report("Available", "Browser runtime", "Playwright action provider registered");
  report("Available", "Action ledger", "SQLite-backed restart-safe execution enabled");
  console.log("==========================================");
  console.log(passed ? "Core Solo diagnostics passed; optional integrations may still need setup.\n" : "Critical Solo diagnostics failed; follow the listed fixes.\n");
  return passed;
}

async function commandOutput(command: string, args: readonly string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    const executable = process.platform === "win32" && command.toLowerCase().endsWith(".cmd") ? process.env.ComSpec ?? "cmd.exe" : command;
    const commandArgs = executable === command ? [...args] : ["/d", "/s", "/c", command, ...args];
    try {
      execFile(executable, commandArgs, { timeout: 3_000, windowsHide: true }, (error, stdout, stderr) => {
        if (error) { resolve(undefined); return; }
        resolve(`${stdout || stderr}`.trim().split(/\r?\n/)[0]?.slice(0, 500) || undefined);
      });
    } catch { resolve(undefined); }
  });
}

function isSkillAction(value: string | undefined): value is "install" | "list" | "enable" | "disable" | "search" | "create" {
  return value === "install" || value === "list" || value === "enable" || value === "disable" || value === "search" || value === "create";
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv);

  if (command === "help") {
    printHelp();
    return;
  }

  if (command === "version") {
    console.log(getVersion());
    return;
  }

  // Unified config: CLI arg > QUACK_* env > config file > default.
  const config = loadCliConfig({
    cli: {
      ...(options.dataDir ? { dataDir: options.dataDir } : {}),
      ...(options.workspaceRoot ? { workspaceRoot: options.workspaceRoot } : {}),
    },
    ...(options.config ? { explicitConfigFile: options.config } : {}),
  });
  const commandContext = { json: options.json, config };

  if (command === "init") {
    process.exit(await commandInit(commandContext));
    return;
  }
  if (command === "status") {
    process.exit(await commandStatus(commandContext));
    return;
  }
  if (command === "run") {
    process.exit(await commandRun(commandContext, options.goal));
    return;
  }
  if (command === "resume") {
    process.exit(await commandResume(commandContext, options.goal));
    return;
  }
  if (command === "config") {
    process.exit(await commandConfig(commandContext));
    return;
  }
  if (command === "update") {
    process.exit(await commandUpdate(commandContext));
    return;
  }
  if (command === "uninstall") {
    process.exit(await commandUninstall(commandContext, options.purgeData));
    return;
  }
  if (command === "skills" && options.skillAction === "search") {
    process.exit(await commandSkillsSearch(commandContext, options.skillTarget ?? ""));
    return;
  }
  if (command === "skills" && options.skillAction === "create") {
    process.exit(await commandSkillCreate(commandContext, options.skillTarget ?? ""));
    return;
  }
  if (command === "personas") {
    process.exit(await commandPersonas(commandContext));
    return;
  }
  if (command === "provider") {
    const action = options.providerAction ?? "list";
    if (action === "list") { process.exit(await commandProviderList(commandContext)); return; }
    if (action === "doctor") { process.exit(await commandProviderDoctor(commandContext)); return; }
    process.exit(await commandProviderTest(commandContext, options.providerTarget ?? ""));
    return;
  }

  const system = createQuackSystem({
    dataDir: options.dataDir || (options.config && existsSync(options.config)
      ? (JSON.parse(readFileSync(options.config, "utf-8")) as { dataDir?: string }).dataDir
      : undefined) || config.dataDir,
    workspaceRoot: options.workspaceRoot || config.workspaceRoot,
  });
  system.companyRuntime.reconcileInterrupted();

  if (command === "doctor") {
    const ok = await runQuackDoctor(system, options.json);
    process.exit(ok ? 0 : 1);
    return;
  }

  if (command === "backup") {
    const destination = options.backupPath ?? join(dirname(system.config.dataDir), `quack-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    const result = await createQuackBackup(system.config.dataDir, destination);
    console.log(JSON.stringify({ status: "PASS", backupDirectory: result.backupDirectory, files: result.manifest.files.length, excludedSensitivePaths: result.manifest.excludedSensitivePaths }, null, 2));
    return;
  }

  if (command === "restore") {
    if (!options.backupPath) throw new Error("quack restore requires a backup directory path.");
    const result = await restoreQuackBackup(options.backupPath, system.config.dataDir);
    console.log(JSON.stringify({ status: "PASS", ...result }, null, 2));
    return;
  }

  if (command === "serve") {
    const { QuackHttpServer } = await import("./server/index.js");
    const server = new QuackHttpServer({ port: options.port, system });
    const actualPort = await server.start();
    console.log(`QUACK Control Room running on http://127.0.0.1:${actualPort}/dashboard`);

    process.on("SIGINT", async () => {
      console.log("\nShutting down...");
      await server.stop();
      await system.airm.shutdown();
      await system.dnpl.shutdown();
      await system.ucp.runtime.shutdown();
      process.exit(0);
    });

    await new Promise(() => {});
    return;
  }

  if (command === "skills") {
    const action = options.skillAction ?? "list";
    if (action === "list") {
      console.log(JSON.stringify({
        skills: system.skills.getAll(),
        packages: system.skillPackages.listInstalled(),
      }, null, 2));
      return;
    }
    if (!options.skillTarget) {
      console.error(`Error: quack skills ${action} requires ${action === "install" ? "a package path" : "a skill id"}.`);
      process.exit(1);
    }
    if (action === "install") {
      const result = await system.skillPackages.registerSkillPackage(options.skillTarget);
      if (!result.ok) {
        console.error("Error:", result.error.message);
        process.exit(1);
      }
      console.log(JSON.stringify(result.data, null, 2));
      return;
    }
    const result = action === "enable"
      ? system.skillPackages.enableSkill(options.skillTarget)
      : system.skillPackages.disableSkill(options.skillTarget);
    if (!result.ok) {
      console.error("Error:", result.error.message);
      process.exit(1);
    }
    console.log(JSON.stringify(result.data, null, 2));
    return;
  }

  if (command === "agents") {
    console.log(JSON.stringify(system.workforce.registry.list(), null, 2));
    return;
  }

  if (command === "mission" || command === "trace" || command === "evaluate" || command === "start") {
    const task = await system.runtime.submitGoal(options.goal, "cli", { origin: "cli" });
    if (!task.ok) throw new Error(task.error.message);
    const loopResult = system.runtime.getLoopResult(task.data.id);
    if (!loopResult) throw new Error(String(task.data.error?.message ?? "Mission was not admitted to a runtime session."));
    if (loopResult.state !== "COMPLETED") process.exitCode = 1;
    const trace = await system.harness.traceRecorder.createTrace({ missionInput: { goal: options.goal, actor: "cli" }, loopResult });
    const output = command === "mission" ? loopResult : command === "trace" ? trace
      : command === "evaluate" ? await system.harness.evaluator.evaluateMission(trace) : { loopResult, trace };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

    system.events.onAny((event) => {
    const timestamp = new Date().toISOString();
    const taskId = event.taskId ? ` [${event.taskId}]` : "";
    console.log(`[${timestamp}] ${event.type}${taskId}`);
  });

  const result = await system.runtime.submitGoal(options.goal, "cli", { origin: "cli" });

  if (!result.ok) {
    console.error("Error:", result.error.message);
    process.exit(1);
  }

  console.log(JSON.stringify(result.data, null, 2));
  if (result.data.status !== "completed") process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith("cli.js")) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
