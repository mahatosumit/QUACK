import { type AgentRole, type AgentStatus, type AgentInstance } from "../../organization/types.js";
import { AgentRegistry as OrgAgentRegistry } from "../../organization/registry.js";
import { defaultAgentConfig } from "../../organization/profiles.js";

/**
 * AgentRegistry — thin wrapper over the organization AgentRegistry offering
 * the quackos.md §8 surface: Create/Spawn/Assign/Monitor/Evaluate/Terminate/
 * Archive. Additive; defers to the org registry for storage.
 */
export class AgentRegistry {
  private archived = new Map<string, { role: AgentRole; terminatedAt: string }>();

  constructor(private readonly inner: OrgAgentRegistry) {}

  spawn(role: AgentRole, id?: string): AgentInstance | undefined {
    const config = defaultAgentConfig(role);
    if (!config) return undefined;
    return this.inner.register(
      id ?? `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      config,
    );
  }

  get(id: string): AgentInstance | undefined {
    return this.inner.get(id);
  }

  getAll(): readonly AgentInstance[] {
    return this.inner.getAll();
  }

  findByRole(role: AgentRole): readonly AgentInstance[] {
    return this.inner.findByRole(role);
  }

  findAvailable(role: AgentRole): AgentInstance | undefined {
    return this.inner.findAvailable(role);
  }

  setStatus(id: string, status: AgentStatus): boolean {
    if (!this.inner.get(id)) return false;
    this.inner.updateStatus(id, status);
    return true;
  }

  terminate(id: string): boolean {
    const agent = this.inner.get(id);
    if (!agent) return false;
    this.inner.remove(id);
    this.archived.set(id, { role: agent.role, terminatedAt: new Date().toISOString() });
    return true;
  }

  archive(id: string): boolean {
    return this.terminate(id);
  }

  isArchived(id: string): boolean {
    return this.archived.has(id);
  }

  getArchived(): readonly { id: string; role: AgentRole; terminatedAt: string }[] {
    return [...this.archived.entries()].map(([id, v]) => ({ id, ...v }));
  }

  count(): number {
    return this.inner.getAll().length;
  }

  getByStatus(status: AgentStatus): readonly AgentInstance[] {
    return this.inner.getAll().filter((a) => a.status === status);
  }
}
