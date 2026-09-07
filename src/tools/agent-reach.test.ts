import assert from "node:assert/strict";
import test from "node:test";
import { AgentReachToolAdapter } from "./agent-reach.js";

test("Agent-Reach adapter is disabled by default", async () => {
  const result = await new AgentReachToolAdapter().search({ query: "QUACK", capability: "external.github_search" });
  assert.equal(result.status, "disabled");
});

test("Agent-Reach adapter bounds results and output and isolates failures", async () => {
  const adapter = new AgentReachToolAdapter({
    enabled: true,
    maxResults: 1,
    maxOutputChars: 5,
    executor: async () => [{ title: "source", url: "https://example.test", text: "abcdef" }, { title: "ignored", text: "ignored" }],
  });
  const result = await adapter.search({ query: "test", capability: "external.web_search", maxResults: 50 });
  assert.equal(result.status, "success");
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0]?.text, "abcde");
});
