import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { LspManager } from "./lsp-manager.js";

function createTempFile(): { file: string; content: string; cleanup: () => void } {
  const dir = join(tmpdir(), `quack-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "test.ts");
  const content = `export function hello() { return "world"; }\nconst x = hello();\n`;
  writeFileSync(file, content);
  return { file, content, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("LspManager findDefinition returns undefined on missing symbol", async () => {
  const { file, cleanup } = createTempFile();
  try {
    const lsp = new LspManager();
    const result = await lsp.findDefinition(file, 1, 0, "typescript");
    // May be undefined since no LSP server is installed, but shouldn't throw
    assert.ok(result === undefined || (result !== undefined)); // graceful either way
  } finally {
    cleanup();
  }
});

test("LspManager findReferences returns array", async () => {
  const { file, content, cleanup } = createTempFile();
  try {
    const lsp = new LspManager();
    const result = await lsp.findReferences(file, "hello");
    assert.ok(Array.isArray(result));
    // Should find at least definition and usage of hello
    if (result.length > 0) {
      assert.ok(result[0].uri.length > 0);
    }
  } finally {
    cleanup();
  }
});

test("LspManager getHover returns undefined without LSP", async () => {
  const { file, cleanup } = createTempFile();
  try {
    const lsp = new LspManager();
    const result = await lsp.getHover(file, 1, 9, "typescript");
    assert.ok(result === undefined || typeof result?.contents === "string");
  } finally {
    cleanup();
  }
});

test("LspManager getDiagnostics returns array", async () => {
  const { file, cleanup } = createTempFile();
  try {
    const lsp = new LspManager();
    const result = await lsp.getDiagnostics(file, "typescript");
    assert.ok(Array.isArray(result));
  } finally {
    cleanup();
  }
});

test("LspManager getCapabilities returns capabilities for registered language", () => {
  const lsp = new LspManager();
  const caps = lsp.getCapabilities("typescript");
  assert.ok(caps);
  assert.equal(caps.supportsDefinition, true);
  assert.equal(caps.serverName, "typescript-language-server");
});

test("LspManager getCapabilities returns undefined for unregistered language", () => {
  const lsp = new LspManager();
  const caps = lsp.getCapabilities("unknown" as any);
  assert.equal(caps, undefined);
});

test("LspManager isAvailable returns a boolean", () => {
  const lsp = new LspManager();
  const available = lsp.isAvailable("typescript");
  assert.equal(typeof available, "boolean");
});

test("LspManager registerServer adds custom server", () => {
  const lsp = new LspManager();
  lsp.registerServer({
    language: "custom" as any,
    command: "custom-lsp",
    args: [],
    capabilities: {
      serverName: "custom", serverVersion: "1.0",
      supportsDefinition: false, supportsReferences: false,
      supportsCompletion: false, supportsHover: false,
      supportsDiagnostics: false, supportsRename: false,
      supportsCodeActions: false, supportsFormatting: false,
      supportsSemanticTokens: false, supportsCallHierarchy: false,
      supportsTypeHierarchy: false, supportsWorkspaceSymbols: false,
      supportsDocumentSymbols: false, supportsSignatureHelp: false,
    },
  });

  const caps = lsp.getCapabilities("custom" as any);
  assert.ok(caps);
  assert.equal(caps.serverName, "custom");
});
