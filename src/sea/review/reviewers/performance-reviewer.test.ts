import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PerformanceReviewer } from "./performance-reviewer.js";

describe("PerformanceReviewer", () => {
  const r = new PerformanceReviewer();

  it("returns no findings for clean code", async () => {
    const f = await r.review("const x = 1;\n", "clean.ts", "ts");
    assert.equal(f.length, 0);
  });

  it("flags chained filter().forEach()", async () => {
    const f = await r.review("items.filter(x => x).forEach(y => {});\n", "a.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("filter().forEach")));
  });

  it("flags chained map().filter()", async () => {
    const f = await r.review("items.map(x => x).filter(y => y);\n", "a.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("map().filter")));
  });

  it("flags nested for loops", async () => {
    const f = await r.review("for (let i = 0; i < n; i++) { for (let j = 0; j < m; j++) {} }\n", "a.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("Nested for loops")));
  });

  it("flags JSON.parse(JSON.stringify())", async () => {
    const f = await r.review("const c = JSON.parse(JSON.stringify(obj));\n", "a.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("JSON.parse")));
  });

  it("flags new Promise()", async () => {
    const f = await r.review("return new Promise((resolve) => {});\n", "a.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("Manual Promise")));
  });

  it("flags custom comparator sort", async () => {
    const f = await r.review("arr.sort((a, b) => a - b);\n", "a.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("comparator sort")));
  });

  it("flags nested awaits", async () => {
    const f = await r.review("const r = await fetch(await getUrl());\n", "a.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("Nested awaits")));
  });
});
