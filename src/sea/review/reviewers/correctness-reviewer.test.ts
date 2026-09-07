import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CorrectnessReviewer } from "./correctness-reviewer.js";

describe("CorrectnessReviewer", () => {
  const r = new CorrectnessReviewer();

  it("returns no findings for clean code", async () => {
    const f = await r.review("const x = 1;\n", "clean.ts", "typescript");
    assert.equal(f.length, 0);
  });

  it("flags loose equality with null (== null)", async () => {
    const f = await r.review("if (x == null) {}\n", "a.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("Loose equality")));
  });

  it("flags empty catch block", async () => {
    const f = await r.review("try { x() } catch () {}\n", "a.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("Empty catch")));
  });

  it("flags async forEach", async () => {
    const f = await r.review("items.forEach(async (i) => {});\n", "a.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("async forEach")));
  });

  it("flags parseInt without radix", async () => {
    const f = await r.review("const n = parseInt('123');\n", "a.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("parseInt")));
  });

  it("flags array push with spread", async () => {
    const f = await r.review("arr.push(...items);\n", "a.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("push with spread")));
  });

  it("flags string coercion via + ''", async () => {
    const f = await r.review('const s = x + "";\n', "a.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("String coercion")));
  });

  it("flags Date constructor with string", async () => {
    const f = await r.review("const d = new Date('2024-01-01');\n", "a.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("Date constructor")));
  });

  it("flags typeof undefined check", async () => {
    const f = await r.review("if (typeof x === 'undefined') {}\n", "a.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("undefined type check")));
  });

  it("includes line numbers in findings", async () => {
    const content = "a\nb\nc\nif (x == null) {}\n";
    const f = await r.review(content, "a.ts", "ts");
    const finding = f.find((x) => x.message.includes("Loose equality"));
    assert.ok(finding);
    assert.equal(finding!.line, 4);
  });
});
