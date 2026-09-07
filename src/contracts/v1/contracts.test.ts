import assert from "node:assert/strict";
import test from "node:test";
import {
  QUACK_CONTRACT_VERSION,
  capabilitySupport,
  satisfiesCapability,
  type ProviderCapabilitySupport,
} from "./contracts.js";

test("v1 contract version is stable and serializable", () => {
  assert.equal(QUACK_CONTRACT_VERSION, "1.0.0");
  assert.equal(JSON.stringify({ contractVersion: QUACK_CONTRACT_VERSION }), '{"contractVersion":"1.0.0"}');
});
test("missing capability is explicitly unsupported", () => {
  assert.deepEqual(capabilitySupport([], "tool-calling"), {
    capability: "tool-calling",
    level: "UNSUPPORTED",
    reason: "Provider did not advertise this capability.",
  });
});

test("capability requirements compare support level and numeric limits", () => {
  const support: ProviderCapabilitySupport = { capability: "context-window", level: "NATIVE", value: 32_768 };
  assert.equal(satisfiesCapability(support, { capability: "context-window", minimumValue: 16_384 }), true);
  assert.equal(satisfiesCapability(support, { capability: "context-window", minimumValue: 65_536 }), false);
  assert.equal(satisfiesCapability({ capability: "tool-calling", level: "DEGRADED" }, {
    capability: "tool-calling",
    minimumLevel: "NATIVE",
  }), false);
});
