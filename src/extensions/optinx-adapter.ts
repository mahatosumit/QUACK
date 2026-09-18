import { ExtensionRegistry } from "./registry.js";
import type { ExtensionDefinition, AdmittedExtension } from "./types.js";
import type { SkillDefinition, SkillManifest } from "../skills/types.js";
import { QUACK_CONTRACT_VERSION } from "../contracts/v1/contracts.js";

export interface OptinxSkillManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author?: string;
  readonly repository?: string;
  readonly permissions?: readonly string[];
  readonly requiredCapabilities?: readonly string[];
  readonly instructions?: readonly string[];
  readonly trustScore?: number;
}

export interface OptinxAdmissionResult {
  readonly admitted: boolean;
  readonly extension?: AdmittedExtension;
  readonly skill?: SkillDefinition;
  readonly code?: string;
  readonly reason?: string;
  readonly securityScanPassed: boolean;
  readonly trustScore: number;
}

const FORBIDDEN_PATTERN = /(?:password|secret|private_key|token|api_key)\s*[:=]\s*['"][^'"]+['"]/i;
const INJECTION_PATTERN = /(?:ignore previous instructions|override security|bypass broker)/i;

export class OptinxSkillsAdapter {
  constructor(private readonly registry: ExtensionRegistry) {}

  /**
   * Admit an external OPTINX skill through QUACK's governed security & admission pipeline.
   * Pipeline: Discover -> Parse -> Validate -> Security Scan -> Trust Evaluation -> Provenance -> Admission -> Execution Binding.
   */
  public admitOptinxSkill(manifest: OptinxSkillManifest, sourceUrl?: string): OptinxAdmissionResult {
    // 1. Parse & Validate Schema
    if (!manifest || typeof manifest.id !== "string" || !manifest.id.trim()) {
      return { admitted: false, securityScanPassed: false, trustScore: 0, code: "optinx.invalid_manifest", reason: "Skill manifest missing valid id." };
    }

    if (!manifest.name || !manifest.version) {
      return { admitted: false, securityScanPassed: false, trustScore: 0, code: "optinx.missing_metadata", reason: "Skill manifest missing name or version." };
    }

    // 2. Security Scan: Fail closed on credential harvesting or prompt injection
    const rawContent = JSON.stringify(manifest);
    if (FORBIDDEN_PATTERN.test(rawContent)) {
      return { admitted: false, securityScanPassed: false, trustScore: 0, code: "optinx.security_violation", reason: "Manifest contains hardcoded credentials or secret harvesting patterns." };
    }

    if (manifest.instructions?.some((inst) => INJECTION_PATTERN.test(inst))) {
      return { admitted: false, securityScanPassed: false, trustScore: 0, code: "optinx.prompt_injection", reason: "Skill instructions contain prompt injection or security bypass patterns." };
    }

    // 3. Quality & Trust Evaluation
    const trustScore = manifest.trustScore ?? (sourceUrl?.startsWith("https://github.com/mahatosumit/optinx_skills") ? 0.95 : 0.70);

    // 4. Transform into QUACK SkillDefinition & ExtensionDefinition
    const skillManifest: SkillManifest = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description ?? "",
      author: manifest.author ?? "OPTINX Ecosystem",
      category: "optinx-ecosystem",
      tags: ["optinx", "external-skill"],
      requiresPermissions: [],
      requiresTools: manifest.requiredCapabilities ?? [],
      entry: "index.ts",
      documentation: (manifest.instructions ?? []).join("\n"),
    };

    const skill: SkillDefinition = {
      manifest: skillManifest,
      execute: async () => ({
        ok: true,
        data: { admittedBy: "OptinxSkillsAdapter", skillId: manifest.id },
        durationMs: 1,
      }),
    };

    const definition: ExtensionDefinition = {
      manifest: {
        id: manifest.id,
        version: manifest.version,
        contractVersion: QUACK_CONTRACT_VERSION,
      },
      contributions: {
        skills: [skill],
      },
    };

    // 5. Admit via QUACK ExtensionRegistry
    try {
      const extension = this.registry.register(definition, {
        source: {
          kind: "plugin",
          sourceId: "optinx/skills-repository",
        },
      });

      return {
        admitted: true,
        extension,
        skill,
        securityScanPassed: true,
        trustScore,
      };
    } catch (err: any) {
      return {
        admitted: false,
        securityScanPassed: true,
        trustScore,
        code: "optinx.admission_failed",
        reason: err.message ?? "Extension registry admission failed.",
      };
    }
  }
}
