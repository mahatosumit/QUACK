import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ArchitectureReviewer } from "./architecture-reviewer.js";

describe("ArchitectureReviewer", () => {
  const r = new ArchitectureReviewer();

  it("returns no findings for a small clean file", async () => {
    const f = await r.review("const x = 1;\n", "small.ts", "typescript");
    assert.equal(f.length, 0);
  });

  it("flags files longer than 500 lines", async () => {
    const lines = Array.from({ length: 510 }, (_, i) => `line ${i}`);
    const f = await r.review(lines.join("\n"), "long.ts", "typescript");
    assert.ok(f.some((x) => x.message.includes("lines long")));
  });

  it("flags deep nesting beyond 6 levels", async () => {
    const content = [
      "function a() {",
      "  if (x) {",
      "    for (;;) {",
      "      while (y) {",
      "        try {",
      "          switch (z) {",
      "            case 1:",
      "              if (w) { // depth 7",
      "              }",
      "          }",
      "        }",
      "      }",
      "    }",
      "  }",
      "}",
    ].join("\n");
    const f = await r.review(content, "deep.ts", "typescript");
    assert.ok(f.some((x) => x.message.includes("nesting depth")));
  });

  it("flags god objects with many methods", async () => {
    const lines = ["class God {"];
    for (let i = 0; i < 25; i++) {
      lines.push(`  function method${i}() {}`);
    }
    lines.push("}");
    const f = await r.review(lines.join("\n"), "god.ts", "typescript");
    assert.ok(f.some((x) => x.message.includes("methods")));
  });

  it("flags god objects with many properties", async () => {
    const lines = ["class God {"];
    for (let i = 0; i < 35; i++) {
      lines.push(`  this.p${i} = ${i};`);
    }
    lines.push("}");
    const f = await r.review(lines.join("\n"), "god2.ts", "typescript");
    assert.ok(f.some((x) => x.message.includes("properties")));
  });
});
