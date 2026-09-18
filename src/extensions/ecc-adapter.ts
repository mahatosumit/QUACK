import { ExtensionRegistry } from "./registry.js";
import type { ExtensionDefinition, AdmittedExtension } from "./types.js";
import type { SkillDefinition, SkillManifest } from "../skills/types.js";
import { QUACK_CONTRACT_VERSION } from "../contracts/v1/contracts.js";

export interface EccCapabilityProfile {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly engineeringRules: readonly string[];
  readonly reviewWorkflows?: readonly string[];
  readonly planningDiscipline?: readonly string[];
}

export interface EccAdapterResult {
  readonly admitted: boolean;
  readonly extension?: AdmittedExtension;
  readonly skills: readonly SkillDefinition[];
  readonly code?: string;
  readonly reason?: string;
}

export class EccCapabilityAdapter {
  constructor(private readonly registry: ExtensionRegistry) {}

  /**
   * Adapts ECC engineering capabilities (planning discipline, review loops, context engineering)
   * cleanly into QUACK's native skill and workflow extension registry.
   */
  public admitEccProfile(profile: EccCapabilityProfile): EccAdapterResult {
    if (!profile || !profile.id || !profile.name) {
      return { admitted: false, skills: [], code: "ecc.invalid_profile", reason: "Invalid ECC capability profile declaration." };
    }

    const planningManifest: SkillManifest = {
      id: `ecc.${profile.id}.planning`,
      name: `${profile.name} — Planning Discipline`,
      version: profile.version ?? "1.0.0",
      description: "ECC engineering workflow: inspect codebase, build dependency map, outline changes before modifying files.",
      author: "ECC / QUACK Adapter",
      category: "ecc-engineering",
      tags: ["ecc", "planning"],
      requiresPermissions: [],
      requiresTools: ["workspace.read", "workspace.code-search"],
      entry: "index.ts",
      documentation: (profile.planningDiscipline ?? [
        "1. Map affected architecture before editing.",
        "2. Identify canonical implementation paths and potential regressions.",
        "3. Plan minimal complete solution.",
      ]).join("\n"),
    };

    const reviewManifest: SkillManifest = {
      id: `ecc.${profile.id}.review`,
      name: `${profile.name} — Verification & Review Loop`,
      version: profile.version ?? "1.0.0",
      description: "ECC verification workflow: run build, test, and lint after every modification.",
      author: "ECC / QUACK Adapter",
      category: "ecc-engineering",
      tags: ["ecc", "verification"],
      requiresPermissions: [],
      requiresTools: ["test.run", "workspace.read"],
      entry: "index.ts",
      documentation: (profile.reviewWorkflows ?? [
        "1. Run unit, integration, and lint checks after code changes.",
        "2. Base diagnostic hypotheses strictly on un-truncated log tracebacks.",
        "3. Fix root cause rather than patching symptoms.",
      ]).join("\n"),
    };

    const skills: SkillDefinition[] = [
      {
        manifest: planningManifest,
        execute: async () => ({
          ok: true,
          data: { admittedBy: "EccCapabilityAdapter", phase: "planning" },
          durationMs: 1,
        }),
      },
      {
        manifest: reviewManifest,
        execute: async () => ({
          ok: true,
          data: { admittedBy: "EccCapabilityAdapter", phase: "review" },
          durationMs: 1,
        }),
      },
    ];

    const definition: ExtensionDefinition = {
      manifest: {
        id: `ecc.${profile.id}`,
        version: profile.version ?? "1.0.0",
        contractVersion: QUACK_CONTRACT_VERSION,
      },
      contributions: {
        skills,
      },
    };

    try {
      const extension = this.registry.register(definition, {
        source: {
          kind: "plugin",
          sourceId: "ecc/engineering-pack",
        },
      });

      return {
        admitted: true,
        extension,
        skills,
      };
    } catch (err: any) {
      return {
        admitted: false,
        skills: [],
        code: "ecc.admission_failed",
        reason: err.message ?? "Failed to admit ECC capabilities.",
      };
    }
  }
}
