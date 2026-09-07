import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDemoProject } from "./demo-project-generator.js";

describe("Demo Project Generator Engine", () => {
  it("creates a complete web project using QUACK OS runtime tools", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "quack-demo-project-"));

    try {
      const res = await createDemoProject(workspaceRoot);
      assert.equal(res.success, true);
      assert.ok(existsSync(join(workspaceRoot, "demo-project", "index.html")));
      assert.ok(existsSync(join(workspaceRoot, "demo-project", "styles.css")));
      assert.ok(existsSync(join(workspaceRoot, "demo-project", "app.js")));

      const indexHtml = readFileSync(join(workspaceRoot, "demo-project", "index.html"), "utf-8");
      assert.ok(indexHtml.includes("QUACK OS"));
      assert.ok(indexHtml.includes("Autonomous Software Engineering Platform"));
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
