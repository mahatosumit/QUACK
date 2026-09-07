import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { now, createId, ok, fail } from "./types.js";

describe("types", () => {
  it("now() returns an IsoTimestamp string", () => {
    const result = now();
    assert.equal(typeof result, "string");
    assert.ok(result.endsWith("Z"));
    assert.ok(result.includes("T"));
  });

  it("createId() returns a non-empty string", () => {
    const id = createId("test");
    assert.equal(typeof id, "string");
    assert.ok(id.length > 0);
  });

  it("createId() includes the prefix", () => {
    const id = createId("task");
    assert.ok(id.startsWith("task_"));
  });

  it("ok() returns success QuackResult", () => {
    const result = ok("hello");
    assert.equal(result.ok, true);
  });

  it("ok() wraps data correctly", () => {
    const data = { foo: 42 };
    const result = ok(data);
    assert.ok(result.ok);
    assert.equal(result.data, data);
    assert.deepEqual(result.data, { foo: 42 });
  });

  it("fail() returns error QuackResult", () => {
    const result = fail({ code: "test.error", message: "Something went wrong", category: "runtime", recoverable: false });
    assert.equal(result.ok, false);
  });

  it("fail() stores error message", () => {
    const result = fail({ code: "test.error", message: "Something went wrong", category: "runtime", recoverable: false });
    assert.ok(!result.ok);
    assert.equal(result.error.message, "Something went wrong");
    assert.equal(result.error.code, "test.error");
    assert.equal(result.error.category, "runtime");
    assert.equal(result.error.recoverable, false);
  });
});
