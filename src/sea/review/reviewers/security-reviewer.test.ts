import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SecurityReviewer } from "./security-reviewer.js";

describe("SecurityReviewer", () => {
  const r = new SecurityReviewer();

  it("returns no findings for clean code", async () => {
    const f = await r.review("const x = 1;\n", "clean.ts", "ts");
    assert.equal(f.length, 0);
  });

  it("flags eval() usage", async () => {
    const f = await r.review("eval(code);\n", "a.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("eval()")));
  });

  it("flags innerHTML assignment", async () => {
    const f = await r.review("el.innerHTML = html;\n", "a.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("innerHTML")));
  });

  it("flags exec() shell command", async () => {
    const f = await r.review("exec('ls -la');\n", "a.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("Shell command")));
  });

  it("flags process.env access", async () => {
    const f = await r.review("const key = process.env.API_KEY;\n", "a.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("environment variables")));
  });

  it("flags hardcoded secrets", async () => {
    const f = await r.review("const password = 'supersecret';\n", "a.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("credential")));
  });

  it("flags new Function()", async () => {
    const f = await r.review("const fn = new Function('a', 'return a');\n", "a.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("Dynamic function")));
  });

  it("flags SQL injection", async () => {
    const f = await r.review("db.query(`SELECT * FROM users WHERE id = ${id}`);\n", "a.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("SQL injection")));
  });

  it("flags unsafe HTML assignment with +=", async () => {
    const f = await r.review("el.innerHTML += more;\n", "a.ts", "ts");
    assert.ok(f.some((x) => x.message.includes("Unsafe HTML")));
  });
});
