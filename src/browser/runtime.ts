import { mkdir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { now, type JsonObject } from "../core/types.js";
import {
  QUACK_CONTRACT_VERSION,
  type ActionDescriptorV1,
  type ActionProviderMetadataV1,
  type ActionProviderV1,
  type ActionRequestV1,
  type ActionResultV1,
  type ExecutionContextV1,
  type ProviderHealthV1,
} from "../contracts/index.js";
import type { NetworkPolicyEngine } from "../security/network-policy.js";

export interface BrowserRuntimeConfig {
  readonly executablePath?: string;
  readonly networkPolicy: NetworkPolicyEngine;
  readonly allowedFileRoots: readonly string[];
  readonly downloadDirectory: string;
  readonly artifactDirectory: string;
  readonly headless?: boolean;
  readonly timeoutMs?: number;
  readonly maxExtractCharacters?: number;
}

/** Playwright browser exposed only through the approval-gated Action Contract. */
export class PlaywrightBrowserActionProvider implements ActionProviderV1 {
  private browser?: Browser;
  private browserContext?: BrowserContext;
  private page?: Page;

  constructor(private readonly config: BrowserRuntimeConfig) {}

  metadata(): ActionProviderMetadataV1 {
    return { contractVersion: QUACK_CONTRACT_VERSION, providerId: "browser.playwright", displayName: "Playwright Browser", transport: "browser", boundary: "local" };
  }

  async health(): Promise<ProviderHealthV1> {
    try {
      await this.ensurePage();
      return { status: "HEALTHY", checkedAt: now(), message: "Isolated Playwright browser context is available." };
    } catch (error) {
      return { status: "OFFLINE", checkedAt: now(), message: safeError(error) };
    }
  }

  async discoverActions(): Promise<readonly ActionDescriptorV1[]> { return browserActionDescriptors(this.config.timeoutMs ?? 30_000); }

  async execute(request: ActionRequestV1, context: ExecutionContextV1): Promise<ActionResultV1> {
    context.signal?.throwIfAborted();
    const page = await this.ensurePage();
    const input = request.input;
    const timeout = this.config.timeoutMs ?? 30_000;
    let output: JsonObject;
    switch (request.actionId) {
      case "browser.open":
      case "browser.navigate": {
        const url = requiredString(input, "url");
        const decision = await this.config.networkPolicy.evaluate({ url, purpose: "browser.navigation", requester: "browser.playwright" });
        if (!decision.allowed) throw new Error(`Navigation denied: ${decision.reason}`);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout });
        output = tagUntrustedWebContent({ url: page.url(), title: await page.title() });
        break;
      }
      case "browser.inspect":
        output = tagUntrustedWebContent({ url: page.url(), title: await page.title() });
        break;
      case "browser.click":
        await page.locator(requiredString(input, "selector")).click({ timeout });
        output = tagUntrustedWebContent({ url: page.url(), clicked: true });
        break;
      case "browser.type":
        await page.locator(requiredString(input, "selector")).fill(requiredString(input, "text"), { timeout });
        output = { typed: true };
        break;
      case "browser.select":
        await page.locator(requiredString(input, "selector")).selectOption(requiredString(input, "value"), { timeout });
        output = { selected: true };
        break;
      case "browser.scroll":
        await page.mouse.wheel(numberValue(input, "deltaX", 0), numberValue(input, "deltaY", 700));
        output = { scrolled: true };
        break;
      case "browser.extract": {
        const selector = optionalString(input, "selector");
        const text = selector ? await page.locator(selector).innerText({ timeout }) : await page.locator("body").innerText({ timeout });
        output = tagUntrustedWebContent({ url: page.url(), text: text.slice(0, this.config.maxExtractCharacters ?? 100_000), truncated: text.length > (this.config.maxExtractCharacters ?? 100_000) });
        break;
      }
      case "browser.screenshot": {
        await mkdir(this.config.artifactDirectory, { recursive: true });
        const path = resolve(this.config.artifactDirectory, `browser-${Date.now()}.png`);
        await page.screenshot({ path, fullPage: Boolean(input["fullPage"]), timeout });
        output = { path, contentType: "image/png" };
        break;
      }
      case "browser.download": {
        await mkdir(this.config.downloadDirectory, { recursive: true });
        const downloadPromise = page.waitForEvent("download", { timeout });
        await page.locator(requiredString(input, "selector")).click({ timeout });
        const download = await downloadPromise;
        const path = resolve(this.config.downloadDirectory, safeFilename(download.suggestedFilename()));
        await download.saveAs(path);
        output = { path, suggestedFilename: download.suggestedFilename() };
        break;
      }
      case "browser.upload": {
        const path = resolve(requiredString(input, "path"));
        assertContained(path, this.config.allowedFileRoots);
        await page.locator(requiredString(input, "selector")).setInputFiles(path, { timeout });
        output = { selectedForUpload: true, filename: path.split(/[\\/]/).pop() ?? "file" };
        break;
      }
      case "browser.wait":
        await page.waitForTimeout(Math.min(numberValue(input, "milliseconds", 500), 10_000));
        output = { waited: true };
        break;
      default:
        throw new Error(`Unsupported browser action ${request.actionId}.`);
    }
    return { executionId: context.executionId, providerId: "browser.playwright", actionId: request.actionId, status: "SUCCEEDED", output, evidenceIds: [] };
  }

  async cancel(): Promise<void> { await this.page?.close({ runBeforeUnload: false }); this.page = undefined; }

  async close(): Promise<void> {
    await this.browserContext?.close();
    await this.browser?.close();
    this.page = undefined; this.browserContext = undefined; this.browser = undefined;
  }

  private async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    this.browser = await chromium.launch({ executablePath: this.config.executablePath, headless: this.config.headless ?? true });
    this.browserContext = await this.browser.newContext({ acceptDownloads: true, serviceWorkers: "block", permissions: [] });
    await this.browserContext.route("**/*", async (route) => {
      const request = route.request();
      if (request.url().startsWith("data:") || request.url().startsWith("about:")) { await route.continue(); return; }
      const decision = await this.config.networkPolicy.evaluate({ url: request.url(), purpose: "browser.navigation", requester: "browser.playwright" });
      if (decision.allowed) await route.continue(); else await route.abort("blockedbyclient");
    });
    this.page = await this.browserContext.newPage();
    return this.page;
  }
}

export function tagUntrustedWebContent(data: JsonObject): JsonObject {
  return { provenance: "UNTRUSTED_WEB_CONTENT", policyAuthority: false, data };
}

export function browserActionDescriptors(timeoutMs: number): readonly ActionDescriptorV1[] {
  const descriptor = (id: string, riskClass: ActionDescriptorV1["riskClass"], sideEffect: ActionDescriptorV1["sideEffect"], properties: JsonObject, required: string[] = []): ActionDescriptorV1 => ({
    contractVersion: QUACK_CONTRACT_VERSION, id: `browser.${id}`, providerId: "browser.playwright", name: id, description: `Browser ${id} operation`,
    inputSchema: { type: "object", properties, required, additionalProperties: false }, riskClass, sideEffect,
    externalCommunication: ["click", "upload"].includes(id), financialImpact: false, authenticationScopes: [], requiredPermissions: ["browser.control"],
    idempotent: ["inspect", "extract", "screenshot", "scroll", "wait"].includes(id), supportsDryRun: false, supportsCompensation: false,
    timeoutMs, dataClassification: "confidential", networkRequirements: ["network.http"], approval: riskClass === "READ_ONLY" || riskClass === "LOW_RISK_WRITE" ? "NEVER" : "POLICY",
  });
  return [
    descriptor("open", "READ_ONLY", "read", { url: { type: "string" } }, ["url"]),
    descriptor("navigate", "READ_ONLY", "read", { url: { type: "string" } }, ["url"]),
    descriptor("inspect", "READ_ONLY", "read", {}),
    descriptor("click", "DATA_MODIFICATION", "write", { selector: { type: "string" } }, ["selector"]),
    descriptor("type", "LOW_RISK_WRITE", "write", { selector: { type: "string" }, text: { type: "string" } }, ["selector", "text"]),
    descriptor("select", "LOW_RISK_WRITE", "write", { selector: { type: "string" }, value: { type: "string" } }, ["selector", "value"]),
    descriptor("scroll", "READ_ONLY", "read", { deltaX: { type: "number" }, deltaY: { type: "number" } }),
    descriptor("download", "READ_ONLY", "read", { selector: { type: "string" } }, ["selector"]),
    descriptor("upload", "EXTERNAL_COMMUNICATION", "write", { selector: { type: "string" }, path: { type: "string" } }, ["selector", "path"]),
    descriptor("screenshot", "READ_ONLY", "read", { fullPage: { type: "boolean" } }),
    descriptor("extract", "READ_ONLY", "read", { selector: { type: "string" } }),
    descriptor("wait", "READ_ONLY", "read", { milliseconds: { type: "number" } }),
  ];
}

function requiredString(input: JsonObject, key: string): string { const value = input[key]; if (typeof value !== "string" || !value.trim()) throw new Error(`${key} must be a non-empty string.`); return value; }
function optionalString(input: JsonObject, key: string): string | undefined { const value = input[key]; return typeof value === "string" && value.trim() ? value : undefined; }
function numberValue(input: JsonObject, key: string, fallback: number): number { const value = input[key]; return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function safeFilename(value: string): string { return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 200) || "download"; }
function assertContained(path: string, roots: readonly string[]): void {
  if (!roots.some((root) => { const rel = relative(resolve(root), path); return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)); })) throw new Error("Browser file path is outside allowed roots.");
}
function safeError(error: unknown): string { return (error instanceof Error ? error.message : String(error)).slice(0, 1_000); }
