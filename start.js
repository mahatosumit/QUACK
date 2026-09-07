#!/usr/bin/env node

/**
 * QUACK OS Universal Cross-Platform Launcher
 * Compatible with Windows, Linux, and macOS.
 */

import { execSync, spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname);

function log(emoji, message) {
  console.log(`[QUACK] ${emoji} ${message}`);
}

function error(message) {
  console.error(`[QUACK] ❌ ${message}`);
}

// 1. Check Node.js Version
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split(".")[0], 10);

log("ℹ️", `Detected Node.js ${nodeVersion} on ${process.platform} (${process.arch})`);

if (majorVersion < 20) {
  error(`QUACK OS requires Node.js >= 20.0.0. Current version is ${nodeVersion}.`);
  process.exit(1);
}

// 2. Auto-Install Dependencies if Missing or Outdated
const nodeModulesPath = resolve(rootDir, "node_modules");
const packageJsonPath = resolve(rootDir, "package.json");

let needsInstall = !existsSync(nodeModulesPath);

if (!needsInstall && existsSync(packageJsonPath)) {
  const pkgTime = statSync(packageJsonPath).mtimeMs;
  const nmTime = statSync(nodeModulesPath).mtimeMs;
  if (pkgTime > nmTime) {
    needsInstall = true;
  }
}

if (needsInstall) {
  log("📦", "Dependencies missing or outdated. Installing automatically...");
  try {
    execSync("npm install", { cwd: rootDir, stdio: "inherit" });
    log("✅", "Dependencies installed successfully.");
  } catch (err) {
    error(`Failed to install dependencies: ${err.message}`);
    process.exit(1);
  }
} else {
  log("✅", "Dependencies are up-to-date.");
}

// 3. Auto-Build if Needed
const distPath = resolve(rootDir, "dist");
if (!existsSync(distPath)) {
  log("🔨", "Building QUACK OS...");
  try {
    execSync("npm run build", { cwd: rootDir, stdio: "inherit" });
    log("✅", "Build complete.");
  } catch (err) {
    error(`Build failed: ${err.message}`);
    process.exit(1);
  }
}

// 4. Run Doctor Diagnostics (non-fatal)
log("🏥", "Running system diagnostics...");
try {
  execSync("node dist/cli.js doctor", { cwd: rootDir, stdio: "inherit" });
} catch {
  log("⚠️", "System diagnostics completed with warnings.");
}

// 5. Parse CLI Args or Default to Desktop Server ('serve')
const userArgs = process.argv.slice(2);
let defaultArgs = userArgs;
if (userArgs.length === 0) {
  defaultArgs = ["serve", "--port", "3000"];
} else if (userArgs[0].startsWith("-")) {
  defaultArgs = ["serve", ...userArgs];
}

log("🚀", `Launching QUACK OS [${defaultArgs.join(" ")}]...`);

const serverProc = spawn(process.execPath, [resolve(rootDir, "dist/cli.js"), ...defaultArgs], {
  cwd: rootDir,
  stdio: "inherit",
});

serverProc.on("error", (err) => {
  error(`Failed to start QUACK OS process: ${err.message}`);
  process.exit(1);
});

serverProc.on("exit", (code) => {
  if (code !== 0 && code !== null) {
    error(`QUACK OS exited with code ${code}`);
  }
  process.exit(code ?? 0);
});
