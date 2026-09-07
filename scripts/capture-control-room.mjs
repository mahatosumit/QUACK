import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { createQuackSystem } from "../dist/system/create-system.js";
import { QuackHttpServer } from "../dist/server/index.js";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
if (!existsSync(edgePath)) throw new Error("Microsoft Edge was not found at the expected Windows path.");

const output = resolve(process.argv[2] ?? "artifacts/control-room");
const dataDir = await mkdtemp(join(tmpdir(), "quack-visual-"));
const system = createQuackSystem({ dataDir, workspaceRoot: process.cwd() });
const server = new QuackHttpServer({ system, port: 0 });
const browser = await chromium.launch({ executablePath: edgePath, headless: true });

try {
  await mkdir(output, { recursive: true });
  await server.start();
  const sizes = [
    ["desktop-1920x1080", 1920, 1080],
    ["laptop-1440x900", 1440, 900],
    ["compact-1366x768", 1366, 768],
  ];
  for (const [name, width, height] of sizes) {
    for (const theme of ["dark", "light"]) {
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
      await context.addInitScript((selectedTheme) => {
        localStorage.setItem("quack-setup-complete", "1");
        localStorage.setItem("quack-theme", selectedTheme);
      }, theme);
      const page = await context.newPage();
      await page.goto(`${server.address().url}/dashboard`, { waitUntil: "networkidle" });
      await page.screenshot({ path: join(output, `${name}-${theme}.png`), fullPage: true });
      if (name === "laptop-1440x900" && theme === "dark") {
        await page.getByRole("link", { name: "Models", exact: true }).click();
        await page.getByRole("heading", { name: "Provider Control Center" }).waitFor();
        await page.screenshot({ path: join(output, "models-1440x900-dark.png"), fullPage: true });
        await page.getByRole("link", { name: "Actions", exact: true }).click();
        await page.getByRole("heading", { name: "Capability catalog" }).waitFor();
        await page.screenshot({ path: join(output, "actions-1440x900-dark.png"), fullPage: true });
      }
      await context.close();
    }
  }
  console.log(`Captured Control Room screenshots in ${output}`);
} finally {
  await browser.close();
  await server.stop();
  await system.airm.shutdown();
  await system.dnpl.shutdown();
  await system.ucp.runtime.shutdown();
  await rm(dataDir, { recursive: true, force: true });
}

process.exit(0);
