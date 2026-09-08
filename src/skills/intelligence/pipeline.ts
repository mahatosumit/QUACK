/**
 * Phase 7B — External Skill Intelligence Pipeline.
 *
 * Analyzes a LOCAL checkout of an external repository (the user clones or
 * provides the path; QUACK never fetches-and-executes remote code here).
 * The pipeline is read-only static analysis:
 *
 *   SkillAnalyzer    — walk the repo, extract manifests/skills/personas/docs
 *   SkillClassifier  — derive risk class + trust posture from evidence
 *   SkillSecurityReviewer — inspection findings (injection, harvesting, …)
 *   SkillAdapter     — propose a QUACK skill-package conversion plan
 *   SkillInstaller   — NO execution: writes a candidate package for the
 *                      existing human-approval workflow
 *                      (SkillPackageManager + DiscoveredSkillRegistry)
 *
 * Nothing in this module executes external code. Adaptation produces
 * declarative artifacts only; activation always flows through the canonical
 * governed path.
 */
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { classifySkillRisk, type SkillRiskClass, type UniversalSkillKind } from "../universal.js";
import { PrivacyFirewall } from "../discovery/privacy.js";
import { resolveInsideRoot } from "../../platform/paths.js";

export interface SecurityFinding {
  readonly severity: "BLOCKER" | "WARNING" | "INFO";
  readonly kind: string;
  readonly detail: string;
}

/** Static file-analysis rules for external repositories. */
const ANALYSIS_RULES: ReadonlyArray<{ readonly kind: string; readonly severity: SecurityFinding["severity"]; readonly test: RegExp; readonly files?: RegExp }> = [
  { kind: "shell-injection", severity: "BLOCKER", test: /\b(?:rm\s+-rf|mkfs|dd\s+if=|curl[^"']*\|\s*(?:sh|bash)|wget[^"']*\|\s*(?:sh|bash))\b/ },
  { kind: "prompt-injection", severity: "BLOCKER", test: /ignore (?:all )?(?:previous|prior) instructions|disregard (?:your )?(?:system|safety) (?:prompt|instructions)|you are now/i },
  { kind: "credential-harvest", severity: "BLOCKER", test: /\b(?:reads?|sends?|uploads?|exfiltrates?|collects?|harvests?|access(?:es)?)\b.{0,40}\b(?:\.env|ssh|credentials|cookies|passwords|keychain)\b/i },
  { kind: "obfuscated-execution", severity: "BLOCKER", test: /\b(?:eval\s*\(|new\s+Function\s*\()/ },
  { kind: "dynamic-shell", severity: "WARNING", test: /\b(?:execSync|spawnSync|exec|spawn)\s*\(/, files: /\.(ts|js|mjs|cjs|py)$/ },
  { kind: "hidden-network", severity: "WARNING", test: /\b(?:webhook|callback|beacon|telemetry|analytics\.|posthog|sentry)\b/i },
  { kind: "elevated-shell", severity: "WARNING", test: /\b(?:sudo|runas|powershell\s+-enc|cmd\s+\/c)\b/i },
  { kind: "secret-shaped-literal", severity: "WARNING", test: /\b(?:sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/ },
  { kind: "postinstall-script", severity: "WARNING", test: /"postinstall"|"preinstall"/, files: /package\.json$/ },
];

const ANALYZED_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs", ".json", ".md", ".yaml", ".yml", ".py", ".sh", ".ps1", ".txt", ".toml"]);
const SKIP_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "target", "vendor", "__pycache__", ".venv"]);
/**
 * BLOCKER rules apply to the skill execution surface only — a repository's
 * own CI pipelines, tests, installers, and scripts directory are not code
 * QUACK would ever adapt or execute, so findings there are downgraded to
 * WARNING (still reported, never silently ignored). Non-executable prose and
 * config (.md/.json/.yaml) can carry shell-injection TEXT that cannot run;
 * only executable code files (.ts/.js/.py/.sh/.ps1) keep BLOCKER severity
 * for executable patterns.
 */
const BLOCKER_EXEMPT_PATHS = /(^|\/)(\.github|\.gitlab-ci|test|tests|__tests__|test-infrastructure|docs?|examples?|scripts?)(\/|$)|(^|\/)(install|uninstall|setup)\.(sh|ps1)$/i;
const EXECUTABLE_EXTENSIONS = /\.(ts|js|mjs|cjs|py|sh|ps1)$/;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 400;

/** What the analyzer learned about an external repository. */
export interface RepositoryAnalysis {
  readonly repository: string;
  readonly root: string;
  readonly analyzedAt: string;
  readonly fileCount: number;
  readonly languages: readonly string[];
  /** Declared runtime dependencies (package.json / pyproject style). */
  readonly dependencies: readonly string[];
  /** Detected capability surfaces: skills, agents, tools, workflows, mcp. */
  readonly capabilities: readonly RepositoryCapability[];
  readonly findings: readonly SecurityFinding[];
  readonly networkRequirements: readonly string[];
  readonly filesystemRequirements: readonly string[];
  readonly secretRequirements: readonly string[];
  readonly executionModel: "declarative-workflow" | "static-instructions" | "native-code" | "mcp-server" | "unknown";
  readonly license: string | undefined;
}

export interface RepositoryCapability {
  readonly kind: "skill" | "agent-persona" | "tool" | "workflow" | "mcp-server" | "prompt";
  readonly name: string;
  readonly path: string;
  readonly summary: string;
}

/** --- SkillAnalyzer ------------------------------------------------------- */

export class SkillAnalyzer {
  private readonly firewall = new PrivacyFirewall();

  /** Statically analyze a local repository checkout. Read-only. */
  async analyze(root: string): Promise<RepositoryAnalysis> {
    const files = await this.collect(root);
    const findings: SecurityFinding[] = [];
    const languages = new Set<string>();
    const dependencies = new Set<string>();
    const capabilities: RepositoryCapability[] = [];
    const networkRequirements = new Set<string>();
    const filesystemRequirements = new Set<string>();
    const secretRequirements = new Set<string>();
    let executionModel: RepositoryAnalysis["executionModel"] = "unknown";
    let license: string | undefined;

    for (const file of files) {
      if (file.endsWith(".ts")) languages.add("TypeScript");
      if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) languages.add("JavaScript");
      if (file.endsWith(".py")) languages.add("Python");
      if (file.endsWith(".sh")) languages.add("Shell");
      if (file.endsWith(".ps1")) languages.add("PowerShell");

      let content: string;
      try {
        const info = await stat(file);
        if (info.size > MAX_FILE_BYTES) continue;
        content = await readFile(file, "utf8");
      } catch {
        continue;
      }

      // Rule findings per file. Findings outside the adaptation surface and
      // executable-pattern findings in non-executable files are downgraded
      // to WARNING: still reported, never silently ignored.
      const rel0 = relative(root, file).replace(/\\/g, "/");
      const exempt = BLOCKER_EXEMPT_PATHS.test(rel0);
      const nonExecutable = !EXECUTABLE_EXTENSIONS.test(rel0);
      for (const rule of ANALYSIS_RULES) {
        if (rule.files && !rule.files.test(file)) continue;
        if (!rule.test.test(content)) continue;
        const downgrade = (exempt || nonExecutable) && rule.kind !== "prompt-injection";
        findings.push({
          severity: rule.severity === "BLOCKER" && downgrade ? "WARNING" : rule.severity,
          kind: rule.kind,
          detail: `${rel0} matches ${rule.kind} pattern${downgrade ? " (outside executable adaptation surface — downgraded)" : ""}.`,
        });
      }

      // Capability surfaces by convention.
      const rel = relative(root, file).replace(/\\/g, "/");
      if (/(^|\/)(skills?|agents?|personas?|prompts?)\//.test(rel) && file.endsWith(".md")) {
        capabilities.push({
          kind: /agents?|personas?/.test(rel) ? "agent-persona" : /prompts?/.test(rel) ? "prompt" : "skill",
          name: rel.replace(/\.md$/, ""),
          path: rel,
          summary: firstMeaningfulLine(content),
        });
      }
      if (file.endsWith("skill.json") || file.endsWith("manifest.json") || file.endsWith("skill.yaml") || file.endsWith("SKILL.md")) {
        capabilities.push({ kind: "skill", name: rel, path: rel, summary: firstMeaningfulLine(content) });
        executionModel = file.endsWith(".json") ? "declarative-workflow" : "static-instructions";
      }
      if (/mcp/i.test(rel) && /\.(ts|js|py)$/.test(file)) {
        capabilities.push({ kind: "mcp-server", name: rel, path: rel, summary: firstMeaningfulLine(content) });
        executionModel = "mcp-server";
      }
      if (/\btool\b/i.test(rel) && /\.(ts|js)$/.test(file)) {
        capabilities.push({ kind: "tool", name: rel, path: rel, summary: firstMeaningfulLine(content) });
      }

      // package.json dependency extraction.
      if (file.endsWith("package.json")) {
        try {
          const pkg = JSON.parse(content) as { readonly dependencies?: Record<string, string>; readonly devDependencies?: Record<string, string>; readonly license?: string; readonly scripts?: Record<string, string> };
          for (const key of [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]) dependencies.add(key);
          if (pkg.license) license ??= String(pkg.license);
          const scripts = pkg.scripts ?? {};
          if ("postinstall" in scripts || "preinstall" in scripts) {
            findings.push({ severity: "WARNING", kind: "postinstall-script", detail: `${rel} declares an install lifecycle script.` });
          }
        } catch { /* unparseable package.json is a finding, not a crash */ }
      }

      // Network / secret signal detection.
      if (/\bhttps?:\/\/(?!localhost|127\.0\.0\.1)/.test(content)) {
        networkRequirements.add("external-http");
      }
      if (/\b(?:fetch|axios|got|http\.request|requests\.|urllib)\b/.test(content)) {
        networkRequirements.add("http-client");
      }
      if (/\b(?:writeFile|fs\.write|open\(.*['"]w|os\.open\(.*O_WRONLY)\b/.test(content)) {
        filesystemRequirements.add("write");
      }
      if (/\b(?:process\.env\.([A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z_]*)|os\.environ\[?[A-Z_]*(?:KEY|TOKEN|SECRET))/.test(content)) {
        secretRequirements.add("credential-env");
      }
    }

    if (languages.size > 0 && executionModel === "unknown") executionModel = "native-code";
    if (secretRequirements.size > 0) {
      findings.push({ severity: "WARNING", kind: "secret-requirements", detail: "Repository reads credential-shaped environment variables." });
    }

    const safe = this.firewall.evaluate({
      repository: root, languages: [...languages], dependencies: [...dependencies],
      networkRequirements: [...networkRequirements], secretRequirements: [...secretRequirements],
    } as never as import("../../core/types.js").JsonObject);
    if (safe.decision === "DENY") {
      findings.push({ severity: "BLOCKER", kind: "privacy-firewall", detail: "Repository metadata was denied by the privacy firewall." });
    }

    return {
      repository: basename(root),
      root,
      analyzedAt: new Date().toISOString(),
      fileCount: files.length,
      languages: [...languages],
      dependencies: [...dependencies],
      capabilities,
      findings,
      networkRequirements: [...networkRequirements],
      filesystemRequirements: [...filesystemRequirements],
      secretRequirements: [...secretRequirements],
      executionModel,
      license,
    };
  }

  private async collect(root: string): Promise<string[]> {
    const files: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      if (files.length >= MAX_FILES) return;
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); }
      catch { return; }
      for (const entry of entries) {
        if (files.length >= MAX_FILES) return;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (SKIP_DIRECTORIES.has(entry.name)) continue;
          await walk(full);
        } else if (ANALYZED_EXTENSIONS.has(extname(entry.name))) {
          files.push(full);
        }
      }
    };
    await walk(root);
    return files;
  }
}

/** --- SkillClassifier ----------------------------------------------------- */

export interface Classification {
  readonly riskClass: SkillRiskClass;
  readonly executionModel: RepositoryAnalysis["executionModel"];
  /** Can this repo be adapted into a declarative QUACK skill safely? */
  readonly adaptability: "declarative" | "instructions-only" | "requires-tool-port" | "not-recommended";
  readonly rationale: string;
}

export class SkillClassifier {
  classify(analysis: RepositoryAnalysis): Classification {
    const riskClass = classifySkillRisk({
      permissions: [],
      filesystemRequirements: analysis.filesystemRequirements,
      networkRequirements: analysis.networkRequirements,
      secretRequirements: analysis.secretRequirements,
    });
    const blockers = analysis.findings.filter(finding => finding.severity === "BLOCKER");
    const harvesting = analysis.findings.some(finding => finding.kind === "credential-harvest")
      || analysis.secretRequirements.length > 0;
    let adaptability: Classification["adaptability"];
    let rationale: string;
    if (blockers.length > 0) {
      adaptability = "not-recommended";
      rationale = `Blockers present: ${blockers.map(finding => finding.kind).join(", ")}.`;
    } else if (analysis.executionModel === "declarative-workflow" && !harvesting) {
      adaptability = "declarative";
      rationale = "Declarative/instruction content can be adapted into a governed QUACK workflow skill.";
    } else if (analysis.executionModel === "static-instructions" && !harvesting) {
      adaptability = "instructions-only";
      rationale = "Content adapts to instruction-only skill; capabilities above LOW risk need explicit approval before any workflow conversion.";
    } else if (harvesting) {
      adaptability = "instructions-only";
      rationale = "Credential-harvesting language or secret requirements detected; adaptation is instruction-only and requires review.";
    } else if (analysis.executionModel === "mcp-server") {
      adaptability = "requires-tool-port";
      rationale = "MCP server: adapt as an MCP integration tool behind the capability broker, not as an inline skill.";
    } else {
      adaptability = "instructions-only";
      rationale = "Native code cannot be adapted for execution; only documentation/instructions may be extracted.";
    }
    return { riskClass, executionModel: analysis.executionModel, adaptability, rationale };
  }
}

/** --- SkillSecurityReviewer ------------------------------------------------ */

export class SkillSecurityReviewer {
  review(analysis: RepositoryAnalysis, classification: Classification): {
    readonly verdict: "APPROVE_CANDIDATE" | "REVIEW_REQUIRED" | "REJECT";
    readonly blockers: readonly SecurityFinding[];
    readonly warnings: readonly SecurityFinding[];
    readonly summary: string;
  } {
    const blockers = analysis.findings.filter(finding => finding.severity === "BLOCKER");
    const warnings = analysis.findings.filter(finding => finding.severity === "WARNING");
    const harvesting = analysis.findings.some(finding => finding.kind === "credential-harvest")
      || analysis.secretRequirements.length > 0;
    const verdict = blockers.length > 0
      ? "REJECT"
      : classification.riskClass === "HIGH" || warnings.length > 3 || harvesting || classification.adaptability === "requires-tool-port"
        ? "REVIEW_REQUIRED"
        : "APPROVE_CANDIDATE";
    return {
      verdict,
      blockers,
      warnings,
      summary: verdict === "REJECT"
        ? `Rejected: ${blockers.map(f => f.kind).join(", ") || "high-risk non-adaptable content"}.`
        : verdict === "REVIEW_REQUIRED"
          ? `Review required: risk=${classification.riskClass}, ${warnings.length} warning(s), adaptability=${classification.adaptability}.`
          : `Candidate approved for skill-package generation: risk=${classification.riskClass}, ${warnings.length} warning(s).`,
    };
  }
}

/** --- SkillAdapter --------------------------------------------------------- */

export interface AdaptationPlan {
  readonly skillId: string;
  readonly name: string;
  readonly category: string;
  readonly description: string;
  /** The QUACK skill kind the adaptation produces. */
  readonly kind: UniversalSkillKind;
  readonly permissions: readonly string[];
  readonly allowedTools: readonly string[];
  readonly instructions: string;
  readonly notes: readonly string[];
}

export class SkillAdapter {
  /** Propose a QUACK skill adaptation from an approved analysis. Static only. */
  adapt(analysis: RepositoryAnalysis, classification: Classification, options: { readonly skillId?: string } = {}): AdaptationPlan {
    const skillId = options.skillId ?? sanitize(`${analysis.repository}-adapted`);
    const notes: string[] = [];
    const permissions: string[] = [];
    if (analysis.executionModel === "native-code" || analysis.executionModel === "mcp-server") {
      notes.push("External code is never executed by QUACK. Only instructions/documentation are adapted.");
    }
    if (analysis.secretRequirements.length > 0) {
      notes.push("Original repository reads credentials; the adapted skill must NOT, and any credential need flows through SecretProvider approval.");
      permissions.push("secrets.read");
    }
    if (analysis.networkRequirements.length > 0) {
      notes.push("Original repository performs network access; the adapted skill is instruction-only about it.");
      permissions.push("network.http");
    }
    return {
      skillId,
      name: titleCase(skillId),
      category: classification.adaptability === "declarative" ? "workflow" : "instructions",
      description: `Adapted from ${analysis.repository}: ${analysis.capabilities.length} capability surface(s), ${analysis.fileCount} analyzed files. ${classification.rationale}`,
      kind: classification.adaptability === "declarative" ? "WORKFLOW" : "INSTRUCTION_ONLY",
      permissions,
      allowedTools: [],
      instructions: buildInstructions(analysis),
      notes,
    };
  }
}

/** --- SkillInstaller -------------------------------------------------------- */

export class SkillInstaller {
  /**
   * Materialize an approved adaptation as a QUACK skill-package CANDIDATE in
   * a staging directory. This writes declarative artifacts only — never
   * executes anything — and returns the package path for the human-approval
   * flow (`quack skills install <path>` → validate → enable).
   */
  async stage(plan: AdaptationPlan, analysis: RepositoryAnalysis, destinationRoot: string): Promise<string> {
    const packageRoot = join(destinationRoot, plan.skillId);
    const containment = resolveInsideRoot(destinationRoot, packageRoot);
    if (!containment.allowed) throw new Error("Staging path escape — refusing to write.");
    await mkdir(packageRoot, { recursive: true });

    const manifest = {
      id: plan.skillId,
      name: plan.name,
      version: "0.1.0",
      description: plan.description,
      author: "quack-skill-intelligence",
      category: plan.category,
      tags: ["adapted", "external", analysis.repository],
      trustLevel: "community",
      // Adapted knowledge skills declare the read-only shape the governed
      // installer validates: capability + tool + a single bounded step.
      requiredCapabilities: ["permission.workspace.read"],
      requiresPermissions: plan.permissions,
      allowedTools: ["core.workspace.list-files"],
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      executionLimits: { timeoutMs: 30_000, maxIterations: 1, maxToolCalls: 1, maxRetriesPerStep: 0 },
      provenance: {
        sourceUrl: analysis.root,
        contentHash: createHash("sha256").update(JSON.stringify(analysis)).digest("hex"),
      },
    };

    await writeFile(join(packageRoot, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
    await writeFile(join(packageRoot, "skill-analysis.json"), JSON.stringify({
      purpose: `Adapted capability from ${analysis.repository}.`,
      dependencies: analysis.dependencies,
      permissionsRequired: plan.permissions,
      filesystemAccess: analysis.filesystemRequirements,
      networkRequirements: analysis.networkRequirements,
      executionModel: analysis.executionModel,
      securityRisk: analysis.findings,
      adaptationRecommendation: plan.notes.length > 0 ? plan.notes : "Adaptation is instruction-only; no external code executes.",
      analyzedAt: analysis.analyzedAt,
      sourceRepository: analysis.repository,
    }, null, 2) + "\n", "utf8");
    await writeFile(join(packageRoot, "workflow.json"), JSON.stringify({
      steps: [
        {
          id: "reference-scan",
          description: "Scan the workspace so the adapted knowledge skill stays grounded in real files.",
          requiredTools: ["core.workspace.list-files"],
          toolInvocations: [
            { toolId: "core.workspace.list-files", input: { path: ".", depth: 1 } },
          ],
          timeoutMs: 10_000,
        },
      ],
      note: "Adapted knowledge skill: one read-only grounding step. No external code is ever executed.",
    }, null, 2) + "\n", "utf8");

    return packageRoot;
  }
}

/** --- Pipeline façade -------------------------------------------------------- */

export interface IntelligenceReport {
  readonly analysis: RepositoryAnalysis;
  readonly classification: Classification;
  readonly review: ReturnType<SkillSecurityReviewer["review"]>;
  readonly plan: AdaptationPlan | undefined;
}

/** Run the full static pipeline over a local repository checkout. */
export async function analyzeRepository(root: string): Promise<IntelligenceReport> {
  const analyzer = new SkillAnalyzer();
  const analysis = await analyzer.analyze(root);
  const classifier = new SkillClassifier();
  const classification = classifier.classify(analysis);
  const review = new SkillSecurityReviewer().review(analysis, classification);
  const plan = review.verdict !== "REJECT" ? new SkillAdapter().adapt(analysis, classification) : undefined;
  return { analysis, classification, review, plan };
}

// --- helpers -----------------------------------------------------------------

function firstMeaningfulLine(content: string): string {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.replace(/^[#>\-*\s]+/, "").trim();
    if (trimmed.length > 8) return trimmed.slice(0, 200);
  }
  return "";
}

function buildInstructions(analysis: RepositoryAnalysis): string {
  const capabilities = analysis.capabilities.slice(0, 10)
    .map(capability => `- ${capability.kind}: ${capability.name} — ${capability.summary}`).join("\n");
  return [
    `# ${analysis.repository} (adapted reference)`,
    "",
    `This skill carries STATIC KNOWLEDGE from an analyzed external repository. It never executes the original code.`,
    "",
    "## Capabilities observed in the source repository",
    capabilities || "- (none detected)",
    "",
    "## Usage",
    "Consult these notes when planning tasks related to this domain. For live behavior, request an explicit,",
    "separately-approved integration; this skill grants no permissions by itself.",
    "",
    `Source: ${analysis.root} · Analyzed: ${analysis.analyzedAt} · Files: ${analysis.fileCount}`,
  ].join("\n");
}

function basename(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

function extname(name: string): string {
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index);
}

function sanitize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "external-skill";
}

function titleCase(value: string): string {
  return value.split("-").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
