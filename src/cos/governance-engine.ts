import { createId, now } from "../core/types.js";
import { type PolicyDefinition, type PolicyScope, type PolicySeverity } from "./types.js";
import { type AgentRole } from "../organization/types.js";

interface EnforcementResult {
  passed: boolean;
  violations: { policyId: string; rule: string; message: string }[];
}

export class GovernanceEngine {
  private policies = new Map<string, PolicyDefinition>();

  create(params: {
    name: string;
    description: string;
    scope: PolicyScope;
    severity?: PolicySeverity;
    rules: { field: string; condition: string; value: unknown }[];
    enforcement?: "automatic" | "manual" | "audit";
    createdBy?: string;
  }): PolicyDefinition {
    const policy: PolicyDefinition = {
      id: createId("policy"),
      name: params.name,
      description: params.description,
      scope: params.scope,
      severity: params.severity ?? "required",
      rules: params.rules,
      enforcement: params.enforcement ?? "manual",
      createdBy: params.createdBy ?? "organization",
      createdAt: now(),
      enabled: true,
    };
    this.policies.set(policy.id, policy);
    return policy;
  }

  get(id: string): PolicyDefinition | undefined {
    return this.policies.get(id);
  }

  getAll(): PolicyDefinition[] {
    return [...this.policies.values()];
  }

  getByScope(scope: PolicyScope): PolicyDefinition[] {
    return this.getAll().filter((p) => p.scope === scope && p.enabled);
  }

  enable(id: string): boolean {
    const p = this.policies.get(id);
    if (!p) return false;
    p.enabled = true;
    return true;
  }

  disable(id: string): boolean {
    const p = this.policies.get(id);
    if (!p) return false;
    p.enabled = false;
    return true;
  }

  remove(id: string): boolean {
    return this.policies.delete(id);
  }

  enforce(policyId: string, target: Record<string, unknown>): EnforcementResult {
    const policy = this.policies.get(policyId);
    if (!policy || !policy.enabled) return { passed: true, violations: [] };
    const violations: EnforcementResult["violations"] = [];
    for (const rule of policy.rules) {
      const value = target[rule.field];
      const pass = this.evaluateCondition(value, rule.condition, rule.value);
      if (!pass) {
        violations.push({
          policyId: policy.id,
          rule: `${rule.field} ${rule.condition} ${rule.value}`,
          message: `${policy.name}: expected ${rule.field} ${rule.condition} ${rule.value}, got ${value}`,
        });
      }
    }
    return { passed: violations.length === 0, violations };
  }

  enforceAll(scope: PolicyScope, target: Record<string, unknown>): EnforcementResult {
    const policies = this.getByScope(scope);
    const allViolations: EnforcementResult["violations"] = [];
    for (const p of policies) {
      const result = this.enforce(p.id, target);
      allViolations.push(...result.violations);
    }
    return { passed: allViolations.length === 0, violations: allViolations };
  }

  getStats(): { total: number; enabled: number; byScope: Record<string, number> } {
    const byScope: Record<string, number> = {};
    for (const p of this.getAll()) {
      byScope[p.scope] = (byScope[p.scope] ?? 0) + 1;
    }
    return {
      total: this.policies.size,
      enabled: this.getAll().filter((p) => p.enabled).length,
      byScope,
    };
  }

  clear(): void {
    this.policies.clear();
  }

  private evaluateCondition(value: unknown, condition: string, expected: unknown): boolean {
    switch (condition) {
      case "eq": return value === expected;
      case "neq": return value !== expected;
      case "gt": return typeof value === "number" && typeof expected === "number" && value > expected;
      case "gte": return typeof value === "number" && typeof expected === "number" && value >= expected;
      case "lt": return typeof value === "number" && typeof expected === "number" && value < expected;
      case "lte": return typeof value === "number" && typeof expected === "number" && value <= expected;
      case "in": return Array.isArray(expected) && expected.includes(value);
      case "nin": return !Array.isArray(expected) || !expected.includes(value);
      case "exists": return value !== undefined && value !== null;
      case "type": return typeof value === expected;
      default: return true;
    }
  }
}
