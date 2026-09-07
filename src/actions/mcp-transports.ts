import { isAbsolute, relative, resolve } from "node:path";
import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import type { JsonObject, JsonValue } from "../core/types.js";
import type { NetworkPolicyEngine } from "../security/network-policy.js";
import type {
  McpCallResult,
  McpClientTransport,
  McpPromptDefinition,
  McpResourceDefinition,
  McpToolDefinition,
} from "./mcp.js";

export type McpExecutionProfile = "TRUSTED" | "RESTRICTED" | "ISOLATED";

interface CommonMcpClientConfig {
  readonly clientName?: string;
  readonly clientVersion?: string;
  readonly timeoutMs?: number;
  readonly versionNegotiation?: "legacy" | "auto";
}

export interface StdioMcpClientConfig extends CommonMcpClientConfig {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly allowedWorkingDirectories?: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
  readonly grantedSecrets?: readonly string[];
  readonly profile: McpExecutionProfile;
  readonly isolation?: "container" | "restricted-process";
  readonly maxOutputBytes?: number;
}

export interface HttpMcpClientConfig extends CommonMcpClientConfig {
  readonly url: string;
  readonly networkPolicy: NetworkPolicyEngine;
  readonly requesterId: string;
  readonly bearerToken?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

abstract class OfficialMcpClient implements McpClientTransport {
  private client?: Client;
  private connecting?: Promise<Client>;

  protected constructor(private readonly common: CommonMcpClientConfig) {}
  protected abstract createTransport(): StdioClientTransport | StreamableHTTPClientTransport;
  protected async beforeClose(): Promise<void> {}

  async health(signal?: AbortSignal): Promise<{ readonly healthy: boolean; readonly message?: string }> {
    try {
      const client = await this.ensureClient(signal);
      await client.ping({ signal, timeout: this.common.timeoutMs ?? 30_000 });
      return { healthy: true, message: `MCP ${client.getServerVersion()?.name ?? "server"} is healthy.` };
    } catch (error) {
      await this.reset();
      return { healthy: false, message: safeError(error) };
    }
  }

  async listTools(signal?: AbortSignal): Promise<readonly McpToolDefinition[]> {
    const result = await (await this.ensureClient(signal)).listTools(undefined, { signal, timeout: this.common.timeoutMs ?? 30_000 });
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: jsonObject(tool.inputSchema),
      outputSchema: tool.outputSchema ? jsonObject(tool.outputSchema) : undefined,
      annotations: tool.annotations ? {
        readOnlyHint: tool.annotations.readOnlyHint,
        destructiveHint: tool.annotations.destructiveHint,
        idempotentHint: tool.annotations.idempotentHint,
        openWorldHint: tool.annotations.openWorldHint,
      } : undefined,
    }));
  }

  async listResources(signal?: AbortSignal): Promise<readonly McpResourceDefinition[]> {
    const result = await (await this.ensureClient(signal)).listResources(undefined, { signal, timeout: this.common.timeoutMs ?? 30_000 });
    return result.resources.map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
      mimeType: resource.mimeType,
    }));
  }

  async listPrompts(signal?: AbortSignal): Promise<readonly McpPromptDefinition[]> {
    const result = await (await this.ensureClient(signal)).listPrompts(undefined, { signal, timeout: this.common.timeoutMs ?? 30_000 });
    return result.prompts.map((prompt) => ({
      name: prompt.name,
      description: prompt.description,
      arguments: prompt.arguments?.map((argument) => ({ name: argument.name, required: argument.required })),
    }));
  }

  async callTool(name: string, input: JsonObject, signal?: AbortSignal): Promise<McpCallResult> {
    const result = await (await this.ensureClient(signal)).callTool(
      { name, arguments: input },
      { signal, timeout: this.common.timeoutMs ?? 30_000, maxTotalTimeout: this.common.timeoutMs ?? 30_000 },
    );
    return normalizeCallResult(result);
  }

  async cancel(_executionId: string): Promise<void> {
    // The official client maps AbortSignal cancellation to the negotiated MCP mechanism.
  }

  async close(): Promise<void> { await this.reset(); }

  private async ensureClient(signal?: AbortSignal): Promise<Client> {
    if (this.client) return this.client;
    if (!this.connecting) {
      this.connecting = (async () => {
        const client = new Client(
          { name: this.common.clientName ?? "quack-os", version: this.common.clientVersion ?? "1.0.0" },
          { versionNegotiation: { mode: this.common.versionNegotiation ?? "auto" } },
        );
        await client.connect(this.createTransport(), { signal, timeout: this.common.timeoutMs ?? 30_000 });
        this.client = client;
        return client;
      })().finally(() => { this.connecting = undefined; });
    }
    return this.connecting;
  }

  private async reset(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.connecting = undefined;
    if (!client) return;
    try { await this.beforeClose(); } finally { await client.close(); }
  }
}

/** RESTRICTED constrains startup configuration only; child code retains host process authority. */
export class StdioMcpClient extends OfficialMcpClient {
  private readonly environment: Record<string, string>;
  private readonly cwd?: string;

  constructor(private readonly config: StdioMcpClientConfig) {
    super(config);
    if (!config.command.trim()) throw new Error("MCP stdio command is required.");
    if (config.profile === "ISOLATED") throw new Error("ISOLATED MCP execution is unavailable: no enforcing process-isolation launcher is implemented.");
    this.cwd = validateWorkingDirectory(config.cwd, config.allowedWorkingDirectories, config.profile);
    this.environment = buildMcpEnvironment(config.environment, config.grantedSecrets);
  }

  protected createTransport(): StdioClientTransport {
    return new StdioClientTransport({
      command: this.config.command,
      args: [...(this.config.args ?? [])],
      cwd: this.cwd,
      env: this.environment,
      stderr: "pipe",
      maxBufferSize: this.config.maxOutputBytes ?? 1_000_000,
    });
  }
}

export class StreamableHttpMcpClient extends OfficialMcpClient {
  private transport?: StreamableHTTPClientTransport;

  constructor(private readonly config: HttpMcpClientConfig) {
    super(config);
    const target = new URL(config.url);
    if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error("MCP HTTP endpoint must use http or https.");
  }

  protected createTransport(): StreamableHTTPClientTransport {
    const transport = new StreamableHTTPClientTransport(new URL(this.config.url), {
      requestInit: { headers: this.config.headers },
      authProvider: this.config.bearerToken ? { token: async () => this.config.bearerToken! } : undefined,
      fetch: (input, init) => this.config.networkPolicy.fetch({
        url: String(input),
        purpose: "mcp.http",
        requester: this.config.requesterId,
      }, init),
    });
    this.transport = transport;
    return transport;
  }

  protected async beforeClose(): Promise<void> {
    try { await this.transport?.terminateSession(); } catch { /* session may already be gone */ }
    this.transport = undefined;
  }
}

export function buildMcpEnvironment(explicit: Readonly<Record<string, string>> = {}, grantedSecrets: readonly string[] = []): Record<string, string> {
  const environment = getDefaultEnvironment();
  for (const key of Object.keys(environment)) if (isSecretName(key)) delete environment[key];
  for (const [key, value] of Object.entries(explicit)) {
    if (isSecretName(key) && !grantedSecrets.includes(key)) throw new Error(`MCP secret ${key} was not explicitly granted.`);
    environment[key] = value;
  }
  return environment;
}

function validateWorkingDirectory(cwd: string | undefined, roots: readonly string[] | undefined, profile: McpExecutionProfile): string | undefined {
  if (profile !== "TRUSTED" && !cwd) throw new Error(`${profile} MCP profile requires an explicit working directory.`);
  if (!cwd) return undefined;
  const target = resolve(cwd);
  if (roots && !roots.some((root) => contained(resolve(root), target))) throw new Error("MCP working directory is outside the allowed roots.");
  return target;
}

function contained(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function normalizeCallResult(result: CallToolResult): McpCallResult {
  const serialized = JSON.parse(JSON.stringify(result)) as { content?: JsonValue[]; isError?: boolean; structuredContent?: JsonObject };
  return { content: serialized.content ?? [], isError: serialized.isError, structuredContent: serialized.structuredContent };
}

function jsonObject(value: unknown): JsonObject { return JSON.parse(JSON.stringify(value)) as JsonObject; }
function isSecretName(key: string): boolean { return /(api[_-]?key|token|secret|password|credential|private[_-]?key)/i.test(key); }
function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(bearer|api[_-]?key|token|secret|password)\s*[:=]?\s*[^\s,;]+/gi, "$1=[REDACTED]").slice(0, 1_000);
}
