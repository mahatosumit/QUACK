/**
 * Phase 7D entry — materialize the reasoning pack into a skill root.
 * Usage: node dist/skills/reasoning/materialize.js <destinationRoot>
 */
import { writeReasoningSkillPack } from "./pack.js";

const root = process.argv[2];
if (!root) {
  console.error("usage: node dist/skills/reasoning/materialize.js <destinationRoot>");
  process.exit(2);
}
const result = writeReasoningSkillPack({ destinationRoot: root, overwrite: true });
console.log(JSON.stringify({ written: result.written.length, skipped: result.skipped.length, root }, null, 2));
