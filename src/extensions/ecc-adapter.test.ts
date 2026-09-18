import test from "node:test";
import assert from "node:assert/strict";
import { ExtensionRegistry } from "./registry.js";
import { EccCapabilityAdapter } from "./ecc-adapter.js";

test("EccCapabilityAdapter admits ECC engineering packs cleanly into QUACK native skills", () => {
  const registry = new ExtensionRegistry();
  const adapter = new EccCapabilityAdapter(registry);

  const result = adapter.admitEccProfile({
    id: "swe-practices",
    name: "ECC SWE Best Practices",
    version: "1.0.0",
    engineeringRules: ["Inspect before edit", "Root cause fixes", "Verification loops"],
    planningDiscipline: ["Analyze dependencies first", "Identify canonical paths"],
    reviewWorkflows: ["Run build and unit tests", "Check lint and typecheck"],
  });

  assert.equal(result.admitted, true);
  assert.equal(result.skills.length, 2);
  assert.equal(result.skills[0]!.manifest.id, "ecc.swe-practices.planning");
  assert.equal(result.skills[1]!.manifest.id, "ecc.swe-practices.review");
});
