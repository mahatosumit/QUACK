import { now, type JsonObject, type JsonValue } from "../core/types.js";
import {
  QUACK_CONTRACT_VERSION,
  type ActionDescriptorV1,
  type ActionProviderMetadataV1,
  type ActionProviderV1,
  type ActionRequestV1,
  type ActionResultV1,
  type ActionRiskClass,
  type ExecutionBoundary,
  type ExecutionContextV1,
  type ProviderHealthV1,
} from "../contracts/index.js";
import type { ActionProviderRegistry } from "./runtime.js";

export type McpTransportKind = "stdio" | "streamable-http";

export interface McpToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: JsonObject;
  readonly outputSchema?: JsonObject;
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
    readonly idempotentHint?: boolean;
    readonly openWorldHint?: boolean;
  };
}

export interface McpResourceDefinition {
  readonly uri: string;
  readonly name: string;
  readonly description?: string;
  readonly mimeType?: string;
}

export interface McpPromptDefinition {
  readonly name: string;
  readonly description?: string;
  readonly arguments?: readonly { readonly name: string; readonly required?: boolean }[];
}

export interface McpCallResult {
  readonly content: readonly JsonValue[];
  readonly isError?: boolean;
  readonly structuredContent?: JsonObject;
}

/** Wire clients (official SDK, stdio, or Streamable HTTP) implement this boundary. */
export interface McpClientTransport {
  health(signal?: AbortSignal): Promise<{ readonly healthy: boolean; readonly message?: string }>;
  listTools(signal?: AbortSignal): Promise<readonly McpToolDefinition[]>;
  listResources?(signal?: AbortSignal): Promise<readonly McpResourceDefinition[]>;
  listPrompts?(signal?: AbortSignal): Promise<readonly McpPromptDefinition[]>;
  callTool(name: string, input: JsonObject, signal?: AbortSignal): Promise<McpCallResult>;
  cancel?(executionId: string): Promise<void>;
  close?(): Promise<void>;
}

export interface McpActionProviderConfig {
  readonly serverId: string;
  readonly displayName: string;
  readonly transport: McpTransportKind;
  readonly boundary: ExecutionBoundary;
  readonly allowedTools?: readonly string[];
  readonly deniedTools?: readonly string[];
  readonly requiredPermissions?: readonly string[];
  readonly maxDescriptionCharacters?: number;
  readonly maxOutputBytes?: number;
  readonly defaultTimeoutMs?: number;
}

/** Normalizes an untrusted MCP server into QUACK Action Contract v1. */
export class McpActionProvider implements ActionProviderV1 {
  private enabled = true;

  constructor(
    private readonly config: McpActionProviderConfig,
    private readonly client: McpClientTransport,
  ) {}

  metadata(): ActionProviderMetadataV1 {
    return {
      contractVersion: QUACK_CONTRACT_VERSION,
      providerId: this.config.serverId,
      displayName: this.config.displayName,
      transport: "mcp",
      boundary: this.config.boundary,
    };
  }

  setEnabled(enabled: boolean): void { this.enabled = enabled; }
  isEnabled(): boolean { return this.enabled; }

  async health(context?: Pick<ExecutionContextV1, "signal" | "deadline">): Promise<ProviderHealthV1> {
    if (!this.enabled) return { status: "OFFLINE", checkedAt: now(), message: "MCP server is disabled." };
    const started = Date.now();
    try {
      const result = await this.client.health(context?.signal);
      return {
        status: result.healthy ? "HEALTHY" : "OFFLINE",
        checkedAt: now(),
        latencyMs: Date.now() - started,
        message: sanitizeText(result.message ?? (result.healthy ? "MCP server is healthy." : "MCP server is unavailable."), 500),
      };
    } catch (error) {
      return { status: "OFFLINE", checkedAt: now(), latencyMs: Date.now() - started, message: sanitizeText(safeError(error), 500) };
    }
  }

  async discoverActions(context?: Pick<ExecutionContextV1, "signal" | "deadline">): Promise<readonly ActionDescriptorV1[]> {
    if (!this.enabled) return [];
    const tools = await this.client.listTools(context?.signal);
    return tools.filter((tool) => this.toolAllowed(tool.name)).map((tool) => normalizeMcpTool(this.config, tool));
  }

  async discoverResources(signal?: AbortSignal): Promise<readonly McpResourceDefinition[]> {
    if (!this.enabled || !this.client.listResources) return [];
    return (await this.client.listResources(signal)).map((resource) => ({
      ...resource,
      name: sanitizeText(resource.name, 200),
      description: resource.description ? sanitizeText(resource.description, 1_000) : undefined,
    }));
  }

  async discoverPrompts(signal?: AbortSignal): Promise<readonly McpPromptDefinition[]> {
    if (!this.enabled || !this.client.listPrompts) return [];
    return (await this.client.listPrompts(signal)).map((prompt) => ({
      ...prompt,
      name: sanitizeIdentifier(prompt.name),
      description: prompt.description ? sanitizeText(prompt.description, 1_000) : undefined,
    }));
  }

  async execute(request: ActionRequestV1, context: ExecutionContextV1): Promise<ActionResultV1> {
    if (!this.enabled) return failed(this.config.serverId, request.actionId, context.executionId, "MCP server is disabled.");
    const descriptor = (await this.discoverActions(context)).find((action) => action.id === request.actionId);
    if (!descriptor) return failed(this.config.serverId, request.actionId, context.executionId, "MCP tool is not enabled or does not exist.");
    const toolName = request.actionId.slice(`${this.config.serverId}:`.length);
    const result = await this.client.callTool(toolName, request.input, context.signal);
    const output: JsonObject = result.structuredContent ?? { content: result.content };
    const bytes = Buffer.byteLength(JSON.stringify(output), "utf8");
    if (bytes > (this.config.maxOutputBytes ?? 1_000_000)) {
      return failed(this.config.serverId, request.actionId, context.executionId, "MCP tool output exceeded the configured size limit.");
    }
    return {
      executionId: context.executionId,
      providerId: this.config.serverId,
      actionId: request.actionId,
      status: result.isError ? "FAILED" : "SUCCEEDED",
      output,
      evidenceIds: [],
    };
  }

  async cancel(executionId: string): Promise<void> { await this.client.cancel?.(executionId); }
  async close(): Promise<void> { await this.client.close?.(); }

  private toolAllowed(name: string): boolean {
    if (!/^[A-Za-z0-9._:/-]{1,200}$/.test(name)) return false;
    if (this.config.deniedTools?.includes(name)) return false;
    return !this.config.allowedTools || this.config.allowedTools.includes(name);
  }
}

export class McpServerRegistry {
  private readonly servers = new Map<string, McpActionProvider>();

  constructor(private readonly actions?: ActionProviderRegistry) {}

  register(server: McpActionProvider): void {
    const id = server.metadata().providerId;
    if (this.servers.has(id)) throw new Error(`MCP server ${id} is already registered.`);
    this.servers.set(id, server);
    this.actions?.register(server);
  }

  async remove(serverId: string): Promise<boolean> {
    const server = this.servers.get(serverId);
    if (!server) return false;
    await server.close();
    this.actions?.remove(serverId);
    return this.servers.delete(serverId);
  }

  enable(serverId: string): boolean { const server = this.servers.get(serverId); if (!server) return false; server.setEnabled(true); return true; }
  disable(serverId: string): boolean { const server = this.servers.get(serverId); if (!server) return false; server.setEnabled(false); return true; }
  async start(serverId: string): Promise<ProviderHealthV1> {
    const server = this.servers.get(serverId);
    if (!server) return { status: "OFFLINE", checkedAt: now(), message: "MCP server is not registered." };
    server.setEnabled(true);
    return server.health();
  }
  async stop(serverId: string): Promise<boolean> {
    const server = this.servers.get(serverId);
    if (!server) return false;
    server.setEnabled(false);
    await server.close();
    return true;
  }
  async restart(serverId: string): Promise<ProviderHealthV1> {
    const server = this.servers.get(serverId);
    if (!server) return { status: "OFFLINE", checkedAt: now(), message: "MCP server is not registered." };
    await server.close();
    server.setEnabled(true);
    return server.health();
  }
  async health(serverId: string): Promise<ProviderHealthV1> {
    const server = this.servers.get(serverId);
    return server ? server.health() : { status: "OFFLINE", checkedAt: now(), message: "MCP server is not registered." };
  }
  get(serverId: string): McpActionProvider | undefined { return this.servers.get(serverId); }
  list(): readonly McpActionProvider[] { return [...this.servers.values()]; }
}

function normalizeMcpTool(config: McpActionProviderConfig, tool: McpToolDefinition): ActionDescriptorV1 {
  const riskClass = riskFor(tool);
  const readOnly = riskClass === "READ_ONLY";
  return {
    contractVersion: QUACK_CONTRACT_VERSION,
    id: `${config.serverId}:${tool.name}`,
    providerId: config.serverId,
    name: sanitizeIdentifier(tool.name),
    description: sanitizeText(tool.description ?? "Untrusted MCP tool", config.maxDescriptionCharacters ?? 2_000),
    inputSchema: sanitizeSchema(tool.inputSchema),
    outputSchema: tool.outputSchema ? sanitizeSchema(tool.outputSchema) : undefined,
    riskClass,
    sideEffect: tool.annotations?.destructiveHint ? "destructive" : readOnly ? "read" : "write",
    externalCommunication: tool.annotations?.openWorldHint ?? config.boundary !== "local",
    financialImpact: false,
    authenticationScopes: [],
    requiredPermissions: [...(config.requiredPermissions ?? []), "mcp.execute"],
    idempotent: tool.annotations?.idempotentHint ?? readOnly,
    supportsDryRun: false,
    supportsCompensation: false,
    timeoutMs: config.defaultTimeoutMs ?? 30_000,
    dataClassification: "confidential",
    networkRequirements: config.transport === "streamable-http" ? ["network.http"] : [],
    approval: riskClass === "READ_ONLY" ? "NEVER" : "POLICY",
  };
}

function riskFor(tool: McpToolDefinition): ActionRiskClass {
  if (tool.annotations?.destructiveHint) return "DESTRUCTIVE";
  if (tool.annotations?.readOnlyHint) return "READ_ONLY";
  if (tool.annotations?.openWorldHint) return "EXTERNAL_COMMUNICATION";
  return "DATA_MODIFICATION";
}

function sanitizeSchema(schema: JsonObject): JsonObject {
  const encoded = JSON.stringify(schema);
  if (Buffer.byteLength(encoded, "utf8") > 100_000) throw new Error("MCP schema exceeds the 100 KB safety limit.");
  if (encoded.includes("__proto__") || encoded.includes("constructor")) throw new Error("MCP schema contains prohibited keys.");
  return JSON.parse(encoded) as JsonObject;
}

function sanitizeText(value: string, maximum: number): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, maximum);
}

function sanitizeIdentifier(value: string): string { return sanitizeText(value, 200); }
function safeError(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function failed(providerId: string, actionId: string, executionId: string, error: string): ActionResultV1 {
  return { executionId, providerId, actionId, status: "FAILED", output: { error }, evidenceIds: [] };
}
