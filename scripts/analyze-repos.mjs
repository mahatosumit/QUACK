import { analyzeRepository } from "../dist/skills/intelligence/pipeline.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

// Usage: node analyze-repos.mjs [--out <dir>] <repoRoot>...
// Analysis output NEVER lands inside or beside the analyzed repository —
// the default is an explicit temp directory, or --out for a chosen parent.
// Canonical committed analyses live in docs/skills/analyses/.
const args = process.argv.slice(2);
let outDirArg;
const repoRoots = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out") {
    outDirArg = args[++i];
    if (!outDirArg) {
      console.error("--out requires a directory path.");
      process.exit(2);
    }
  } else {
    repoRoots.push(args[i]);
  }
}
if (repoRoots.length === 0) {
  console.error("usage: node analyze-repos.mjs [--out <dir>] <repoRoot>...");
  process.exit(2);
}
const outRoot = outDirArg ? resolve(outDirArg) : join(tmpdir(), "quack-skill-analyses");

for (const root of repoRoots) {
  const report = await analyzeRepository(root);
  const { analysis, classification, review, plan } = report;
  const payload = {
    purpose: plan?.description ?? `Analysis of ${analysis.repository} — adaptation not recommended.`,
    dependencies: analysis.dependencies,
    permissionsRequired: plan?.permissions ?? [],
    filesystemAccess: analysis.filesystemRequirements,
    networkRequirements: analysis.networkRequirements,
    executionModel: analysis.executionModel,
    securityRisk: {
      riskClass: classification.riskClass,
      blockers: review.blockers,
      warnings: review.warnings,
      verdict: review.verdict,
      summary: review.summary,
    },
    adaptationRecommendation: classification.rationale + (plan ? ` | Adaptability: ${classification.adaptability}.` : " | REJECTED — no adaptation plan."),
    analyzedAt: analysis.analyzedAt,
    sourceRepository: analysis.repository,
    languages: analysis.languages,
    capabilities: analysis.capabilities.slice(0, 20),
    fileCount: analysis.fileCount,
    license: analysis.license,
  };
  const outDir = join(outRoot, analysis.repository);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "skill-analysis.json"), JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`${analysis.repository}: risk=${classification.riskClass} verdict=${review.verdict} model=${analysis.executionModel} files=${analysis.fileCount} caps=${analysis.capabilities.length} -> ${join(outDir, "skill-analysis.json")}`);
}
console.log(`Output root: ${outRoot} (committed analyses belong in docs/skills/analyses/ — copy deliberately).`);
