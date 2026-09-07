import { describe, it } from "node:test";
import * as assert from "node:assert";
import { createBuiltinSkillCatalog } from "./index.js";
import { SkillLoader } from "../loader.js";

const catalog = createBuiltinSkillCatalog();

const EXPECTED_IDS = [
  "git",
  "terminal",
  "file-manager",
  "testing",
  "documentation",
  "security-review",
  "architecture-review",
  "workspace-index",
  "markdown",
  "dependency-analysis",
];

describe("Built-in skills", () => {
  it("explicitly provides all expected legacy skills", () => {
    const ids = [...catalog.keys()];
    assert.strictEqual(ids.length, EXPECTED_IDS.length);
  });

  it("does not populate a neutral loader through import side effects", () => {
    assert.deepEqual(new SkillLoader().loadBuiltins(), []);
    assert.equal(new SkillLoader(catalog).loadBuiltins().length, EXPECTED_IDS.length);
    assert.deepEqual(new SkillLoader().loadBuiltins(), []);
  });

  for (const id of EXPECTED_IDS) {
    it(`fails closed for unimplemented skill "${id}"`, async () => {
      const skill = catalog.get(id)!();
      const result = await skill.execute({ goal: "execute", parameters: {}, context: {
        workspaceRoot: ".", dataDir: ".", sessionId: "test",
      } });
      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /unsupported/);
      assert.equal(result.data, undefined);
      assert.match(skill.manifest.description, /Unavailable placeholder/);
    });
    it(`should register skill "${id}"`, () => {
      const ids = [...catalog.keys()];
      assert.ok(ids.includes(id), `Expected "${id}" to be registered`);
    });
  }
});
