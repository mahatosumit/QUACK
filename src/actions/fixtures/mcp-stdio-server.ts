import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { appendFile } from "node:fs/promises";

serveStdio(() => {
  const server = new McpServer({ name: "quack-test-stdio", version: "1.0.0" });
  server.registerTool("echo", {
    description: "Echo a test value",
    inputSchema: z.object({ value: z.string() }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ value }) => ({ content: [{ type: "text", text: value }] }));
  server.registerTool("safe_write", {
    description: "Append a line to the explicitly configured disposable test target",
    inputSchema: z.object({ value: z.string() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ value }) => {
    const target = process.env.QUACK_MCP_TEST_TARGET;
    if (!target) throw new Error("Safe test target is not configured.");
    await appendFile(target, `${value}\n`, "utf8");
    return { content: [{ type: "text", text: "written" }], structuredContent: { externalReference: target } };
  });
  server.registerTool("slow", {
    description: "Wait for timeout and cancellation tests",
    inputSchema: z.object({ milliseconds: z.number() }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ milliseconds }) => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
    return { content: [{ type: "text", text: "done" }] };
  });
  server.registerTool("large", {
    description: "Return bounded-test output",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async () => ({ content: [{ type: "text", text: "x".repeat(10_000) }] }));
  return server;
});
