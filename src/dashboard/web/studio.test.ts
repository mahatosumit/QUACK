import test from "node:test";
import assert from "node:assert/strict";
import { STUDIO_API, studioHtml, studioScript, studioStyles } from "./studio.js";

test("QUACK Control Room renders every required solo-production surface", () => {
  const html = studioHtml();
  const script = studioScript();

  for (const label of ["Overview", "Missions", "Agents", "Models", "Actions", "Integrations", "Browser", "Files", "Approvals", "Evidence", "System", "Settings"]) {
    assert.match(html, new RegExp(label, "i"));
  }
  assert.match(script, /window\.confirm/);
  assert.match(script, /dryRun/);
  assert.match(script, /DENY BY DEFAULT/);
  assert.equal(STUDIO_API.proposals, "/improvement/proposals");
  assert.equal(STUDIO_API.actions, "/actions");
});

test("QUACK Studio styles are desktop-first and remain mobile usable", () => {
  const css = studioStyles();
  assert.match(css, /grid-template-columns:224px/);
  assert.match(css, /@media\(max-width:820px\)/);
  assert.match(css, /badge\.risk/);
  assert.match(css, /prefers-reduced-motion/);
});
