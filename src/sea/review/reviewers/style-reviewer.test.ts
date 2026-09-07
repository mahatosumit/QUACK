import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StyleReviewer } from "./style-reviewer.js";

describe("StyleReviewer", () => {
  const r = new StyleReviewer();

  it("returns no findings for a clean file", async () => {
    const f = await r.review("const x = 1;\n", "clean.ts", "ts");
    assert.equal(f.length, 0);
  });

  it("flags long lines > 120 chars", async () => {
    const content = "x".repeat(130) + "\n";
    const f = await r.review(content, "long.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("exceeds 120")));
  });

  it("flags trailing whitespace", async () => {
    const content = "const x = 1;   \n";
    const f = await r.review(content, "trail.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("Trailing whitespace")));
  });

  it("flags missing blank line at end", async () => {
    const content = "const x = 1;";
    const f = await r.review(content, "eof.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("does not end")));
  });

  it("flags large functions > 50 lines", async () => {
    const lines = ["function big() {"];
    for (let i = 0; i < 55; i++) lines.push(`  const x${i} = ${i};`);
    lines.push("}");
    lines.push("");
    const f = await r.review(lines.join("\n"), "bigfn.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("Function is")));
  });

  it("caps long line findings at 5", async () => {
    const lines = Array.from({ length: 10 }, () => "x".repeat(130));
    const f = await r.review(lines.join("\n"), "many.ts", "ts");
    const longlineFindings = f.filter((x) => x.message.includes("exceeds 120"));
    assert.ok(longlineFindings.length <= 5);
  });
});
