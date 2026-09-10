import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { AxeBuilder } from "@axe-core/playwright";
import { createQuackSystem } from "../distributions/swe-system.js";
import { QueuedApprovalCallback } from "../security/approval-queue.js";
import { QuackHttpServer } from "../server/index.js";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

test("Control Room browser E2E passes keyboard and serious axe gates", { skip: !existsSync(edgePath) }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "quack-control-room-"));
  // P2 Approval Center surface needs the queue-backed approver wired.
  const system = createQuackSystem({ dataDir, workspaceRoot: process.cwd(), approver: new QueuedApprovalCallback() });
  const server = new QuackHttpServer({ system, port: 0 });
  const browser = await chromium.launch({ executablePath: edgePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await context.addInitScript(() => localStorage.setItem("quack-setup-complete", "1"));
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

  try {
    await server.start();
    await page.goto(`${server.address().url}/dashboard`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
    assert.equal(await page.locator("#runtime-label").textContent(), "Runtime connected");

    await page.getByRole("link", { name: "Models", exact: true }).click();
    await page.getByRole("heading", { name: "Provider Control Center" }).waitFor();
    await page.getByRole("link", { name: "Actions", exact: true }).click();
    await page.getByRole("heading", { name: "Capability catalog" }).waitFor();
    // P2 Mission Control + Approval Center surfaces must render without
    // client errors (empty-state or populated) and stay accessible.
    await page.getByRole("link", { name: /Approvals/, exact: true }).click();
    await page.getByRole("heading", { name: "Approval queue" }).waitFor();
    await page.getByRole("link", { name: "Missions", exact: true }).click();
    await page.getByRole("heading", { name: "Mission Control" }).waitFor();
    // P6 Agent workspace renders registry + assignment state.
    await page.getByRole("link", { name: "Agents", exact: true }).click();
    await page.getByRole("heading", { name: "Agent workspace" }).waitFor();
    // P3 Console: conversational composer renders, accepts a mission, and
    // the conversation records the real accepted state.
    await page.getByRole("link", { name: "Console", exact: true }).click();
    await page.getByRole("heading", { name: "Conversation" }).waitFor();
    await page.locator("#console-input").fill("Inspect the workspace and summarize findings.");
    await page.locator("#console-submit").click();
    await page.getByText(/accepted \(/).waitFor();

    await page.keyboard.press("Tab");
    assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), "BODY");
    await page.locator("#theme-toggle").click();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "light");

    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious");
    if (blocking.length > 0) console.error(JSON.stringify(blocking.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.target) }))));
    assert.deepEqual(blocking.map((violation) => ({ id: violation.id, nodes: violation.nodes.length })), []);
    assert.deepEqual(consoleErrors, []);
  } catch (error) {
    console.error("Control Room E2E failure:", error);
    throw error;
  } finally {
    await context.close();
    await browser.close();
    await server.stop();
    await system.airm.shutdown();
    await system.dnpl.shutdown();
    await system.ucp.runtime.shutdown();
    await rm(dataDir, { recursive: true, force: true });
  }
});
