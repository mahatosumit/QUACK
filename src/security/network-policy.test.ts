import assert from "node:assert/strict";
import test from "node:test";
import { NetworkPolicyEngine } from "./network-policy.js";

test("network policy denies private, loopback, metadata, IPv6, and non-http targets", async () => {
  const policy = new NetworkPolicyEngine({
    defaultMode: "ALLOW",
    resolve: async (host) => host === "rebinding.example" ? ["192.168.1.10"] : [host],
  });
  for (const url of [
    "http://127.0.0.1/admin", "http://10.0.0.1/", "http://172.16.0.1/", "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://[fc00::1]/", "file:///etc/passwd",
    "http://rebinding.example/",
  ]) assert.equal((await policy.evaluate({ url, purpose: "mcp", requester: "untrusted" })).allowed, false, url);
});

test("explicit Ollama local-service rule permits only configured loopback endpoint", async () => {
  const policy = new NetworkPolicyEngine({
    rules: [{ id: "ollama", mode: "LOCAL_SERVICE", purposes: ["provider.ollama"], hosts: ["127.0.0.1"], ports: [11434], schemes: ["http:"] }],
  });
  assert.equal((await policy.evaluate({ url: "http://127.0.0.1:11434/api/tags", purpose: "provider.ollama", requester: "provider.ollama" })).allowed, true);
  assert.equal((await policy.evaluate({ url: "http://127.0.0.1:8080/admin", purpose: "provider.ollama", requester: "provider.ollama" })).allowed, false);
  assert.equal((await policy.evaluate({ url: "http://127.0.0.1:11434/", purpose: "mcp", requester: "untrusted" })).allowed, false);
});

test("network policy records decisions without URL credentials", async () => {
  const policy = new NetworkPolicyEngine();
  const decision = await policy.evaluate({ url: "https://user:password@example.com/path", purpose: "action", requester: "test" });
  assert.equal(decision.allowed, false);
  assert.doesNotMatch(decision.url, /password|user/);
  assert.equal(policy.recentDecisions().length, 1);
});

test("redirects cannot forward credentials or request bodies to another origin", async (context) => {
  const calls: string[] = [];
  let destination = "https://other.example.test/collect";
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response("redirect", { status: 307, headers: { location: destination } });
  });
  const policy = new NetworkPolicyEngine({ defaultMode: "ALLOW", resolve: async () => ["93.184.216.34"] });
  for (const target of ["https://other.example.test/collect", "https://service.example.test:8443/collect", "http://service.example.test/collect"]) {
    destination = target;
    const before = calls.length;
    await assert.rejects(() => policy.fetch({ url: "https://service.example.test/start", purpose: "mcp", requester: "test" }, {
      method: "POST", headers: { Authorization: "fixture-private", Cookie: "fixture-private", "X-Private-Auth": "fixture-private" }, body: "fixture-private-payload",
    }), /Cross-origin redirects/);
    assert.equal(calls.length, before + 1);
    assert.equal(calls.at(-1), "https://service.example.test/start");
  }
});

test("same-origin redirects are reevaluated and retain authorized request data", async (context) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return calls.length === 1 ? new Response(null, { status: 307, headers: { location: "/final" } }) : new Response("done");
  });
  const policy = new NetworkPolicyEngine({ defaultMode: "ALLOW", resolve: async () => ["93.184.216.34"] });
  const result = await policy.fetch({ url: "https://service.example.test/start", purpose: "mcp", requester: "test" }, {
    method: "POST", headers: { Authorization: "fixture-private" }, body: "fixture-private-payload",
  });
  assert.equal(await result.text(), "done");
  assert.deepEqual(calls.map((call) => call.url), ["https://service.example.test/start", "https://service.example.test/final"]);
  assert.equal(new Headers(calls[1].init?.headers).has("Authorization"), true);
  assert.equal(calls[1].init?.body, calls[0].init?.body);
  assert.equal(policy.recentDecisions().length, 2);
});
