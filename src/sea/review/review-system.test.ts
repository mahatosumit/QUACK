import { describe, it, mock, after } from "node:test";
import assert from "node:assert/strict";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ReviewSystem } from "./review-system.js";

const testFile = join(tmpdir(), `review-system-test-${Date.now()}.ts`);

describe("ReviewSystem", () => {
  const mockSl = {
    getFiles: mock.fn(() => [{ relativePath: "src/test.ts", language: "typescript", lines: 1 }]),
    patches: {
      listAppliedPatches: mock.fn(() => []),
      getPatchedContent: mock.fn(async () => undefined),
    },
  } as any;

  const system = new ReviewSystem(mockSl);

  after(async () => {
    try { await unlink(testFile); } catch { /* ok */ }
  });

  it("review returns a report for a non-existent file", async () => {
    const report = await system.review("src/nonexistent.ts");
    assert.ok(report.target.includes("nonexistent.ts"));
    assert.ok(typeof report.score === "number");
    assert.ok(report.findings.length >= 0);
  });

  it("review returns findings for a real file with issues", async () => {
    await writeFile(testFile, [
      "if (x == null) {}",
      "el.innerHTML = html;",
      "eval(code);",
    ].join("\n"));
    const report = await system.review(testFile);
    assert.ok(report.findings.length > 0);
    assert.ok(report.score < 10);
    assert.equal(report.passed, false);
    assert.ok(report.recommendations.length > 0);
  });

  it("review returns passed:true for a clean file", async () => {
    await writeFile(testFile, "const x = 1;\n");
    const report = await system.review(testFile);
    assert.equal(report.passed, true);
    assert.equal(report.score, 10);
  });

  it("reviewPatch returns not-found for unknown patch", async () => {
    const report = await system.reviewPatch("nonexistent-patch");
    assert.ok(report.recommendations[0].includes("not found"));
    assert.equal(report.passed, true);
  });

  it("reviewPatch reviews patch files", async () => {
    const patchesMock = {
      listAppliedPatches: mock.fn(() => [
        { id: "p1", description: "test patch", files: [{ path: "src/test.ts" }], timestamp: "2026-01-01", status: "applied" },
      ]),
      getPatchedContent: mock.fn(async (_patchId: string, _path: string) => "eval(code);\n"),
    };
    const slWithPatch = {
      getFiles: mock.fn(() => [{ relativePath: "src/test.ts", language: "typescript", lines: 1 }]),
      patches: patchesMock,
    } as any;
    const sys = new ReviewSystem(slWithPatch);
    const report = await sys.reviewPatch("p1");
    assert.ok(report.target.includes("p1"));
    assert.ok(report.findings.length > 0);
  });
});
