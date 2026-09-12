import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createId, type JsonObject } from "../core/types.js";
import { type QuackEvent } from "../events/event-bus.js";
import { createQuackSystem, type QuackSystem } from "../distributions/swe-system.js";
import { type MissionStatus, type MissionSubmission } from "../api/index.js";
import { type QuackConfig } from "../distributions/swe-config.js";
import { buildDashboardState } from "../dashboard/web/index.js";
import { studioHtml, studioScript, studioStyles } from "../dashboard/web/studio.js";
import { type AppRecipeCategory } from "../recipes/types.js";
import { redactSecrets } from "../security/secret-provider.js";

export interface ApiServerConfig {
  readonly host?: string;
  readonly port?: number;
  readonly requestBodyLimitBytes?: number;
  readonly responseBodyLimitBytes?: number;
  readonly authentication?: boolean;
  readonly authToken?: string;
  readonly allowedOrigins?: readonly string[];
  readonly rateLimitPerMinute?: number;
  readonly allowNetworkExposure?: boolean;
  readonly system?: QuackSystem;
  readonly systemConfig?: Partial<QuackConfig>;
}

export interface ApiErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly status: number;
  };
}

export interface ApiMissionRecord {
  readonly id: string;
  readonly state: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  readonly goal: string;
  readonly actor: string;
  readonly missionId?: string;
  /** Durable runtime task id when known — the resume/cancel handle. */
  readonly taskId?: string;
  readonly loopId?: string;
  readonly traceId?: string;
  readonly iterations: number;
  readonly error?: string;
  readonly mode?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly safetyMode?: string;
  readonly dryRun?: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class QuackHttpServer {
  readonly system: QuackSystem;
  private readonly host: string;
  private readonly port: number;
  private readonly requestBodyLimitBytes: number;
  private readonly responseBodyLimitBytes: number;
  private readonly authentication: boolean;
  private readonly authToken: string;
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly rateLimitPerMinute: number;
  private readonly rateWindows = new Map<string, { startedAt: number; count: number }>();
  private readonly server: Server;
  private readonly missions = new Map<string, ApiMissionRecord>();
  private readonly missionControllers = new Map<string, AbortController>();
  private readonly streamClients = new Set<ServerResponse>();
  private readonly events: QuackEvent[] = [];
  private readonly detachEventLog: () => void;

  constructor(config: ApiServerConfig = {}) {
    if (!isLoopbackHost(config.host ?? "127.0.0.1")) throw new Error("QUACK API refuses non-loopback binding: remote authentication is not implemented.");
    this.system = config.system ?? createQuackSystem(config.systemConfig);
    if (!config.system) this.system.companyRuntime.reconcileInterrupted();
    this.host = config.host ?? "127.0.0.1";
    this.port = config.port ?? 0;
    this.requestBodyLimitBytes = config.requestBodyLimitBytes ?? 1024 * 1024;
    this.responseBodyLimitBytes = config.responseBodyLimitBytes ?? 5 * 1024 * 1024;
    this.authentication = config.authentication ?? true;
    this.authToken = config.authToken ?? randomBytes(32).toString("base64url");
    this.allowedOrigins = new Set(config.allowedOrigins ?? []);
    this.rateLimitPerMinute = config.rateLimitPerMinute ?? 240;
    this.server = createServer((request, response) => {
      this.handle(request, response).catch((error) => {
        if (error instanceof HttpError) {
          this.writeError(response, error.status, error.code, error.message);
          return;
        }
        this.writeError(response, 500, "server.internal_error", error instanceof Error ? error.message : String(error));
      });
    });
    this.detachEventLog = this.system.events.onAny((event) => {
      this.events.push(event);
      if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
    });
  }

  async start(): Promise<number> {
    if (this.server.listening) return this.address().port;
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        this.server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off("error", onError);
        resolve(this.address().port);
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(this.port, this.host);
    });
  }

  async stop(): Promise<void> {
    for (const client of this.streamClients) {
      client.end();
    }
    this.streamClients.clear();
    this.detachEventLog();
    await Promise.allSettled(this.system.mcpServers.list().map((server) => server.close()));
    await this.system.browser.close();
    if (!this.server.listening) return;
    const closing = new Promise<void>((resolve, reject) => {
      this.server.close((error) => error ? reject(error) : resolve());
    });
    this.server.closeAllConnections();
    await closing;
  }

  address(): { readonly host: string; readonly port: number; readonly url: string } {
    const address = this.server.address();
    const port = typeof address === "object" && address ? address.port : this.port;
    return { host: this.host, port, url: `http://${this.host}:${port}` };
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.applySecureHeaders(response);
    this.enforceRateLimit(request);
    this.validateHost(request);
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const method = request.method ?? "GET";
    const path = trimTrailingSlash(url.pathname);
    this.validateOrigin(request);
    if (method === "OPTIONS") {
      response.writeHead(204, { "Allow": "GET, POST, PATCH, OPTIONS" });
      response.end();
      return;
    }
    if (method === "GET" && path === "/dashboard") this.issueDashboardSession(response);
    if (!isPublicRoute(method, path)) this.requireAuthentication(request, method);

    if (method === "POST" && path === "/missions") {
      await this.createMission(request, response);
      return;
    }
    if (method === "POST" && path.startsWith("/missions/") && path.endsWith("/cancel")) {
      await this.cancelMission(path, request, response);
      return;
    }
    if (method === "POST" && path.startsWith("/missions/") && path.endsWith("/resume")) {
      await this.resumeMission(path, request, response);
      return;
    }
    if (method === "GET" && path === "/approvals") {
      this.listApprovals(response);
      return;
    }
    if (method === "POST" && path.startsWith("/approvals/") && (path.endsWith("/approve") || path.endsWith("/deny"))) {
      await this.decideApproval(path, request, response);
      return;
    }
    if (method === "GET" && path === "/missions") {
      this.writeJson(response, 200, { missions: this.listMissionRecords() });
      return;
    }
    if (method === "GET" && path.startsWith("/missions/") && path.endsWith("/status")) {
      this.getMissionStatus(path, response);
      return;
    }
    if (method === "GET" && path.startsWith("/missions/") && path.endsWith("/events")) {
      this.getMissionEvents(path, response);
      return;
    }
    if (method === "GET" && path.startsWith("/missions/")) {
      await this.getMission(path, response);
      return;
    }
    if (method === "GET" && path.startsWith("/traces/")) {
      await this.getTrace(path, response);
      return;
    }
    if (method === "GET" && path === "/traces") {
      await this.listTracesByMission(url.searchParams.get("missionId"), response);
      return;
    }
    if (method === "GET" && path === "/audit") {
      await this.getAuditTrail(url.searchParams.get("limit"), response);
      return;
    }
    if (method === "POST" && path === "/skills/import") {
      await this.importSkill(request, response);
      return;
    }
    if (method === "POST" && path.startsWith("/skills/") && path.endsWith("/enable")) {
      this.enableSkill(path, request, response);
      return;
    }
    if (method === "POST" && path.startsWith("/skills/") && path.endsWith("/disable")) {
      this.disableSkill(path, request, response);
      return;
    }
    if (method === "GET" && path === "/skills") {
      this.writeJson(response, 200, { skills: this.system.skills.getAll(), packages: this.system.skillPackages.listInstalled() });
      return;
    }
    if (method === "GET" && path === "/improvement/proposals") {
      await this.listImprovementProposals(response);
      return;
    }
    if (method === "POST" && path.startsWith("/improvement/proposals/") && path.endsWith("/approve")) {
      await this.decideImprovementProposal(path, "APPROVE", request, response);
      return;
    }
    if (method === "POST" && path.startsWith("/improvement/proposals/") && path.endsWith("/reject")) {
      await this.decideImprovementProposal(path, "REJECT", request, response);
      return;
    }
    if (method === "GET" && path.startsWith("/improvement/proposals/")) {
      await this.getImprovementProposal(path, response);
      return;
    }
    if (method === "GET" && path === "/recipes") {
      this.listRecipes(url.searchParams.get("query") ?? "", url.searchParams.get("category") ?? undefined, response);
      return;
    }
    if (method === "POST" && path.startsWith("/recipes/") && path.endsWith("/plan")) {
      await this.planRecipe(path, request, response);
      return;
    }
    if (method === "GET" && path.startsWith("/recipes/")) {
      this.getRecipe(path, response);
      return;
    }
    if (method === "GET" && path === "/providers") {
      await this.listProviders(response);
      return;
    }
    if (method === "POST" && path === "/providers/test") {
      await this.testProvider(request, response);
      return;
    }
    if (method === "POST" && path === "/models/stream") {
      await this.streamModel(request, response);
      return;
    }
    if (method === "GET" && path === "/actions") {
      await this.listActions(response);
      return;
    }
    if (method === "GET" && path === "/mcp") {
      await this.listMcpServers(response);
      return;
    }
    if (method === "GET" && path === "/system/status") {
      await this.getSystemStatus(response);
      return;
    }
    if (method === "GET" && path === "/memory") {
      await this.getMemory(response);
      return;
    }
    if (method === "GET" && path === "/extensions") {
      await this.getExtensions(response);
      return;
    }
    if (method === "GET" && path === "/governed-missions") {
      await this.getGovernedMissions(response);
      return;
    }
    if (method === "GET" && path === "/settings") {
      this.writeJson(response, 200, this.settings());
      return;
    }
    if (method === "PATCH" && path === "/settings") {
      await this.updateSettings(request, response);
      return;
    }
    if (method === "GET" && path === "/agents") {
      this.writeJson(response, 200, { agents: this.system.workforce.registry.list() });
      return;
    }
    if (method === "GET" && path === "/health") {
      this.writeJson(response, 200, this.health());
      return;
    }
    if (method === "GET" && path === "/dashboard") {
      this.writeText(response, 200, studioHtml(), "text/html; charset=utf-8");
      return;
    }
    if (method === "GET" && path === "/dashboard/styles.css") {
      this.writeText(response, 200, studioStyles(), "text/css; charset=utf-8");
      return;
    }
    if (method === "GET" && path === "/dashboard/app.js") {
      this.writeText(response, 200, studioScript(), "application/javascript; charset=utf-8");
      return;
    }
    if (method === "GET" && path === "/dashboard/state") {
      await this.getDashboardState(response);
      return;
    }
    if (method === "GET" && path === "/events") {
      this.streamEvents(request, response);
      return;
    }

    this.writeError(response, 404, "server.not_found", `Route ${method} ${url.pathname} was not found.`);
  }

  private async createMission(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await this.readJson(request);
    if (!isMissionSubmission(body)) {
      this.writeError(response, 400, "mission.invalid_request", "Request body must include a non-empty string goal.");
      return;
    }

    const id = createId("mission_run");
    const now = new Date().toISOString();
    const actor = body.actor ?? "api-server";
    const record: ApiMissionRecord = {
      id,
      state: "QUEUED",
      goal: body.goal,
      actor,
      missionId: body.missionId,
      iterations: 0,
      mode: body.mode,
      providerId: body.providerId,
      model: body.model,
      safetyMode: body.safetyMode,
      dryRun: body.dryRun ?? false,
      createdAt: now,
      updatedAt: now,
    };
    this.missions.set(id, record);
    if (body.dryRun) {
      this.updateMission(id, { state: "COMPLETED", error: "Dry run completed: request was validated and no mission execution was started." });
    } else {
      this.runMission(id, { missionId: body.missionId, goal: body.goal, actor });
    }
    this.writeJson(response, 202, this.missions.get(id));
  }

  private async runMission(id: string, input: MissionSubmission): Promise<void> {
    this.updateMission(id, { state: "RUNNING" });
    const controller = new AbortController();
    this.missionControllers.set(id, controller);
    try {
      const status = await this.system.api.submitMission({ ...input, signal: controller.signal });
      const trace = this.system.api.getTrace(status.loopId);
      this.updateMission(id, {
        state: status.state === "COMPLETED" ? "COMPLETED" : "FAILED",
        missionId: status.missionId,
        taskId: status.taskId,
        loopId: status.loopId,
        traceId: trace?.id,
        iterations: status.iterations,
        error: status.error,
      });
    } catch (error) {
      const cancelled = controller.signal.aborted;
      this.updateMission(id, {
        state: cancelled ? "FAILED" : "FAILED",
        error: cancelled
          ? `Mission cancelled: ${error instanceof Error ? error.message : String(error)}`
          : error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.missionControllers.delete(id);
    }
  }

  /** P1: cancel an in-flight mission by aborting its run; unknown/finished ids fail closed. */
  private async cancelMission(path: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const id = decodeURIComponent(path.slice("/missions/".length, -"/cancel".length));
    await this.readOptionalJson(request); // drain body; none expected
    const controller = this.missionControllers.get(id);
    const record = this.missions.get(id);
    if (controller) {
      controller.abort(new Error("Mission cancelled through the Mission API."));
      this.writeJson(response, 202, { id, state: "CANCELLING", note: "Cancellation was requested; the mission record reflects the terminal state shortly." });
      return;
    }
    if (record) {
      this.writeError(response, 409, "mission.not_cancellable", `Mission ${id} is not running (state ${record.state}).`);
      return;
    }
    this.writeError(response, 404, "mission.not_found", `Mission ${id} was not found.`);
  }

  /** P1: resume an interrupted mission through the canonical recovery path. */
  private async resumeMission(path: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const id = decodeURIComponent(path.slice("/missions/".length, -"/resume".length));
    await this.readOptionalJson(request);
    const record = this.missions.get(id);
    const resumeTarget = record?.taskId ?? id;
    try {
      const status = await this.system.api.resumeMission(resumeTarget);
      if (record) this.updateMission(id, { state: this.recordStateFromStatus(status.state), loopId: status.loopId, iterations: status.iterations, error: status.error });
      this.writeJson(response, 200, { id, status });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "task.not_found") {
        this.writeError(response, 404, "mission.not_found", `Mission ${id} was not found.`);
        return;
      }
      if (code === "recovery.busy") {
        this.writeError(response, 409, "mission.resume_busy", `Mission ${id} already has an executing owner.`);
        return;
      }
      if (code === "recovery.ownership_conflict" || code === "recovery.reconciliation_required" || code === "recovery.invalid_checkpoint") {
        this.writeError(response, 409, "mission.resume_conflict", error instanceof Error ? error.message : String(error));
        return;
      }
      this.writeError(response, 500, "mission.resume_failed", error instanceof Error ? error.message : String(error));
    }
  }

  private recordStateFromStatus(state: string): ApiMissionRecord["state"] {
    if (state === "COMPLETED") return "COMPLETED";
    if (state === "FAILED") return "FAILED";
    if (state === "RUNNING") return "RUNNING";
    return "QUEUED";
  }

  /** P1: list pending approval requests. Absent queued approver fails closed honestly. */
  private listApprovals(response: ServerResponse): void {
    const approvals = this.system.approvals;
    if (!approvals) {
      this.writeError(response, 404, "approval.queue_unavailable", "This system was not started with a queue-backed approver; approval decisions stay in their original surface.");
      return;
    }
    this.writeJson(response, 200, { approvals: approvals.list() });
  }

  /** P1: submit a human decision on a parked approval. Fails closed on unknown/tampered ids. */
  private async decideApproval(path: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const approvals = this.system.approvals;
    if (!approvals) {
      this.writeError(response, 404, "approval.queue_unavailable", "This system was not started with a queue-backed approver; approval decisions stay in their original surface.");
      return;
    }
    const suffix = path.endsWith("/approve") ? "/approve" : "/deny";
    const id = decodeURIComponent(path.slice("/approvals/".length, -suffix.length));
    const body = await this.readJson(request);
    if (!isApprovalDecisionRequest(body)) {
      this.writeError(response, 400, "approval.invalid_decision_request", "A decision requires a non-empty human actor; optional reason string.");
      return;
    }
    const outcome = await approvals.decide(id, { approved: suffix === "/approve", decidedBy: body.actor, reason: body.reason });
    if (!outcome.ok) {
      this.writeError(response, outcome.error.code === "approval.not_pending" ? 404 : 409, outcome.error.code, outcome.error.message);
      return;
    }
    this.writeJson(response, 200, outcome.data);
  }

  private async getMission(path: string, response: ServerResponse): Promise<void> {
    const id = decodeURIComponent(path.slice("/missions/".length));
    const record = this.missions.get(id);
    if (record) {
      const [trace, evaluation, tasks, evidence] = await Promise.all([
        record.loopId ? Promise.resolve(this.system.api.getTrace(record.loopId)) : Promise.resolve(undefined),
        record.loopId ? Promise.resolve(this.system.api.getEvaluation(record.loopId)) : Promise.resolve(undefined),
        this.system.storage.tasks.list(),
        this.system.learningExperiences.list({ taskId: record.loopId ?? record.id }),
      ]);
      this.writeJson(response, 200, {
        ...record,
        detail: {
          trace: trace ?? null,
          evaluation: evaluation ?? null,
          tasks: tasks.filter((task) => task.id === record.id || task.id === record.loopId || task.id === record.missionId),
          evidence,
          events: this.events.filter((event) => event.taskId === record.id || event.taskId === record.loopId),
        },
      });
      return;
    }
    const mission = this.system.cognitiveSystem.missionManager.get(id);
    if (mission) {
      this.writeJson(response, 200, { mission });
      return;
    }
    this.writeError(response, 404, "mission.not_found", `Mission ${id} was not found.`);
  }

  private getMissionStatus(path: string, response: ServerResponse): void {
    const id = decodeURIComponent(path.slice("/missions/".length, -"/status".length));
    const record = this.missions.get(id);
    if (record) {
      this.writeJson(response, 200, this.statusFromRecord(record));
      return;
    }
    const status = this.system.api.getStatus(id);
    if (status) {
      this.writeJson(response, 200, status);
      return;
    }
    this.writeError(response, 404, "mission.not_found", `Mission ${id} was not found.`);
  }

  private getMissionEvents(path: string, response: ServerResponse): void {
    const id = decodeURIComponent(path.slice("/missions/".length, -"/events".length));
    const record = this.missions.get(id);
    if (!record) {
      this.writeError(response, 404, "mission.not_found", `Mission ${id} was not found.`);
      return;
    }
    this.writeJson(response, 200, {
      events: this.events.filter((event) => event.taskId === record.id || event.taskId === record.loopId),
    });
  }

  private async getTrace(path: string, response: ServerResponse): Promise<void> {
    const id = decodeURIComponent(path.slice("/traces/".length));
    const record = this.missions.get(id);
    const trace = record?.loopId ? this.system.api.getTrace(record.loopId) : undefined;
    const persisted = trace ?? await this.system.storage.traces.get(record?.traceId ?? id);
    if (!persisted) {
      this.writeError(response, 404, "trace.not_found", `Trace ${id} was not found.`);
      return;
    }
    this.writeJson(response, 200, persisted);
  }

  /** P1: trace-by-mission lookup over the existing TraceRepository. */
  private async listTracesByMission(missionId: string | null, response: ServerResponse): Promise<void> {
    if (!missionId || !missionId.trim()) {
      this.writeError(response, 400, "trace.mission_required", "Provide ?missionId=… to list traces for one mission.");
      return;
    }
    const traces = await this.system.storage.traces.list({ missionId });
    this.writeJson(response, 200, { missionId, traces });
  }

  /**
   * P7 Audit Center: the governance record, kept deliberately distinct from
   * trace observability. Reads the real audit log through the existing
   * AuditLog; payloads pass the same structural redaction as SSE so secrets
   * never cross this boundary. Authentication is enforced by the server
   * wrapper (same session as every other route — there is no anonymous
   * audit path).
   */
  private async getAuditTrail(limitParam: string | null, response: ServerResponse): Promise<void> {
    const limit = Math.max(1, Math.min(500, Number.parseInt(limitParam ?? "100", 10) || 100));
    const events = await this.system.auditLog.readAll();
    const recent = events.slice(-limit).reverse();
    this.writeJson(response, 200, {
      total: events.length,
      returned: recent.length,
      records: recent.map((event) => ({ ...event, payload: redactEventPayload(event.payload) })),
      note: "Audit is the security/governance record; Trace Center covers mission observability.",
    });
  }

  private async importSkill(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await this.readJson(request);
    if (!isSkillImportRequest(body)) {
      this.writeError(response, 400, "skill.invalid_import_request", "Request body must include a non-empty string path.");
      return;
    }
    const result = await this.system.skillPackages.registerSkillPackage(body.path);
    if (!result.ok) {
      this.writeError(response, result.error.category === "validation" ? 400 : 403, result.error.code, result.error.message);
      return;
    }
    this.writeJson(response, 201, result.data);
  }

  private async enableSkill(path: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const id = decodeURIComponent(path.slice("/skills/".length, -"/enable".length));
    const body = await this.readOptionalJson(request);
    if (!isOptionalVersionRequest(body)) {
      this.writeError(response, 400, "skill.invalid_lifecycle_request", "Optional version must be a string.");
      return;
    }
    const result = this.system.skillPackages.enableSkill(id, body.version);
    if (!result.ok) {
      this.writeError(response, result.error.code === "skill_package.not_found" ? 404 : 400, result.error.code, result.error.message);
      return;
    }
    this.writeJson(response, 200, result.data);
  }

  private async disableSkill(path: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const id = decodeURIComponent(path.slice("/skills/".length, -"/disable".length));
    const body = await this.readOptionalJson(request);
    if (!isOptionalVersionRequest(body)) {
      this.writeError(response, 400, "skill.invalid_lifecycle_request", "Optional version must be a string.");
      return;
    }
    const result = this.system.skillPackages.disableSkill(id, body.version);
    if (!result.ok) {
      this.writeError(response, result.error.code === "skill_package.not_found" ? 404 : 400, result.error.code, result.error.message);
      return;
    }
    this.writeJson(response, 200, result.data);
  }

  private async listImprovementProposals(response: ServerResponse): Promise<void> {
    const proposals = await this.system.selfModification.listExperiments();
    this.writeJson(response, 200, {
      proposals: [...proposals].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)),
      safety: "Proposal creation does not mutate source files. Explicit human approval only records a decision; materialization and promotion remain separate gates.",
    });
  }

  private async getImprovementProposal(path: string, response: ServerResponse): Promise<void> {
    const id = decodeURIComponent(path.slice("/improvement/proposals/".length));
    const proposal = (await this.system.selfModification.listExperiments()).find((candidate) => candidate.id === id);
    if (!proposal) {
      this.writeError(response, 404, "proposal.not_found", `Improvement proposal ${id} was not found.`);
      return;
    }
    this.writeJson(response, 200, proposal);
  }

  private async decideImprovementProposal(path: string, decision: "APPROVE" | "REJECT", request: IncomingMessage, response: ServerResponse): Promise<void> {
    const suffix = decision === "APPROVE" ? "/approve" : "/reject";
    const id = decodeURIComponent(path.slice("/improvement/proposals/".length, -suffix.length));
    const body = await this.readJson(request);
    if (!isProposalDecisionRequest(body)) {
      this.writeError(response, 400, "proposal.invalid_decision_request", "A decision requires confirm: true and a non-empty human actor.");
      return;
    }
    const result = await this.system.selfModification.recordPendingProposalDecision({
      experimentId: id,
      decision,
      actor: body.actor,
      reason: body.reason,
    });
    if (!result.ok) {
      this.writeError(response, result.error.code === "selfmod.not_found" ? 404 : 409, result.error.code, result.error.message);
      return;
    }
    this.writeJson(response, 200, {
      proposal: result.data,
      nextStep: decision === "APPROVE"
        ? "Approved conceptual proposal. No worktree or source mutation has occurred; a separate explicit materialization step is required."
        : "Proposal rejection was persisted. No worktree or source mutation has occurred.",
    });
  }

  private listRecipes(query: string, category: string | undefined, response: ServerResponse): void {
    if (category !== undefined && !isRecipeCategory(category)) {
      this.writeError(response, 400, "recipe.invalid_category", "Recipe category is not supported.");
      return;
    }
    const recipes = query.trim()
      ? this.system.recipes.searchRecipes(query, category ? { category, limit: 50 } : { limit: 50 })
      : this.system.recipes.listRecipes().filter((recipe) => !category || recipe.category === category).map((recipe) => ({ recipe, score: 0, matchedTerms: [] }));
    this.writeJson(response, 200, {
      recipes,
      copyingPolicy: "metadata-and-patterns-only",
    });
  }

  private getRecipe(path: string, response: ServerResponse): void {
    const id = decodeURIComponent(path.slice("/recipes/".length));
    const recipe = this.system.recipes.getRecipe(id);
    if (!recipe) {
      this.writeError(response, 404, "recipe.not_found", `Recipe ${id} was not found.`);
      return;
    }
    this.writeJson(response, 200, recipe);
  }

  private async planRecipe(path: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const id = decodeURIComponent(path.slice("/recipes/".length, -"/plan".length));
    const body = await this.readJson(request);
    if (!isRecipePlanRequest(body)) {
      this.writeError(response, 400, "recipe.invalid_plan_request", "A recipe plan requires a non-empty targetStack string.");
      return;
    }
    const plan = this.system.recipes.planFromRecipe(id, body.targetStack);
    if (!plan) {
      this.writeError(response, 404, "recipe.not_found", `Recipe ${id} was not found.`);
      return;
    }
    this.writeJson(response, 200, plan);
  }

  private async listProviders(response: ServerResponse): Promise<void> {
    const ids = this.system.providers.list();
    const providers = await Promise.all(ids.map(async (id) => {
      const provider = this.system.providers.get(id);
      if (!provider.ok) return { id, available: false };
      try {
        return { id, available: true, capabilities: await provider.data.discover() };
      } catch (error) {
        return { id, available: false, error: error instanceof Error ? error.message : String(error) };
      }
    }));
    this.writeJson(response, 200, {
      providers,
      fallbackOrder: ids,
      note: "Provider credentials are never returned by this API.",
    });
  }

  private async testProvider(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await this.readJson(request);
    if (!isProviderTestRequest(body)) {
      this.writeError(response, 400, "provider.invalid_test_request", "A provider test requires a non-empty providerId.");
      return;
    }
    const provider = this.system.providers.get(body.providerId);
    if (!provider.ok) {
      this.writeError(response, 404, provider.error.code, provider.error.message);
      return;
    }
    const health = await provider.data.healthCheck();
    this.writeJson(response, 200, { providerId: body.providerId, dryRun: true, ...health });
  }

  /**
   * P4: governed model streaming. Every call resolves provider.invoke through
   * the capability broker (GovernedModelRuntime), chunk text is redacted at
   * this wire boundary before being written or emitted, and each chunk is
   * broadcast as `model.stream.chunk` so any `/events` client (Console) sees
   * the same stream. Denial fails closed before any provider is contacted.
   */
  private async streamModel(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await this.readJson(request);
    if (!isModelStreamRequest(body)) {
      this.writeError(response, 400, "model.invalid_stream_request", "A stream requires a non-empty prompt and actor; optional model.");
      return;
    }
    const actor = body.actor;
    const missionId = body.missionId;
    const controller = new AbortController();
    const onClientClose = () => controller.abort(new Error("Client disconnected."));
    request.once("close", onClientClose);
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write(": governed-stream\n\n");
    let chunksEmitted = 0;
    let lastError: string | undefined;
    try {
      const iterator = this.system.governedModelRuntime.stream(
        { prompt: body.prompt, ...(body.model ? { model: body.model } : {}) },
        { missionId, actor, signal: controller.signal },
      );
      for await (const chunk of iterator) {
        if (controller.signal.aborted) break;
        const text = redactSecrets(chunk.text);
        chunksEmitted += 1;
        const payload: JsonObject = {
          providerId: chunk.providerId, model: chunk.model, text, done: chunk.done,
          ...(chunk.usage ? { usage: { inputTokens: chunk.usage.inputTokens, outputTokens: chunk.usage.outputTokens, ...(chunk.usage.totalTokens !== undefined ? { totalTokens: chunk.usage.totalTokens } : {}) } } : {}),
          ...(missionId ? { missionId } : {}),
        };
        response.write(formatSse({ id: createId("event"), type: "model.stream.chunk", timestamp: new Date().toISOString(), actor, payload } as unknown as QuackEvent));
        void this.system.events.emit("model.stream.chunk", payload, { actor }).catch(() => undefined);
        if (chunk.done) break;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      request.removeListener("close", onClientClose);
    }
    response.write(formatSse({ id: createId("event"), type: "model.stream.chunk", timestamp: new Date().toISOString(), actor,
      payload: { providerId: "runtime", model: body.model ?? "auto", text: "", done: true, ...(missionId ? { missionId } : {}), ...(lastError ? { error: redactSecrets(lastError) } : {}), ...(chunksEmitted === 0 && lastError ? { denied: true } : {}) } } as unknown as QuackEvent));
    response.end();
  }

  private async getExtensions(response: ServerResponse): Promise<void> {
    // P10.14 server surface: metadata-only extension catalog. Package
    // content, entry file bodies, and secrets never cross this boundary;
    // records are redacted at the wire like every other surface.
    try {
      const records = await this.system.ecosystem.list();
      this.writeJson(response, 200, {
        readOnly: true,
        extensions: records.map((record) => JSON.parse(redactSecrets(JSON.stringify({
          id: record.id,
          version: record.version,
          kind: record.manifest.kind,
          name: record.manifest.name,
          lifecycle: record.lifecycle,
          signatureState: record.signatureState,
          provenance: { kind: record.provenance.kind },
          declaredCapabilities: record.manifest.capabilities,
          declaredPermissions: record.manifest.permissions,
          dependencyCount: record.manifest.dependencies.length,
          integrityState: record.packageDigest === record.manifest.integrity.digest ? "MATCHED" : "MISMATCHED",
          installedAt: record.installedAt,
        }))) as JsonObject),
      });
    } catch {
      // Malformed registry state fails closed — honest empty surface, never
      // a fabricated catalog.
      this.writeJson(response, 200, { readOnly: true, extensions: [] });
    }
  }

  private async getGovernedMissions(response: ServerResponse): Promise<void> {
    // P11 server surface: metadata-only governed mission runs. Prompts,
    // model output, action arguments, and secrets never cross this
    // boundary; records are already redacted at persistence and are
    // re-redacted at the wire like every other surface.
    try {
      const runs = await this.system.governedMissionLoop.listRuns();
      this.writeJson(response, 200, {
        readOnly: true,
        runs: runs.map((run) => JSON.parse(redactSecrets(JSON.stringify({
          missionId: run.missionId,
          runId: run.runId,
          state: run.currentState ?? "RUNNING",
          stopReason: run.stopReason ?? null,
          iterations: run.iterations.length,
          startedAt: run.startedAt,
          endedAt: run.endedAt ?? null,
          steps: run.iterations.map((step) => ({
            step: step.index,
            capability: step.selectedAction?.capability ?? null,
            status: step.executionResult?.actionResult.status ?? null,
            verification: step.verification?.status ?? null,
            decision: step.permissionDecision?.decision ?? null,
            code: step.observations["code"] ?? null,
            stopReason: step.stopReason ?? null,
          })),
        }))) as JsonObject),
      });
    } catch {
      // Malformed store state fails closed — honest empty surface.
      this.writeJson(response, 200, { readOnly: true, runs: [] });
    }
  }

  private async getMemory(response: ServerResponse): Promise<void> {
    const [missionMemory, evidenceMemory, identityMemory, tasks, semantic] = await Promise.all([
      this.system.memory.search({ limit: 100 }),
      this.system.learningExperiences.list(),
      this.system.identityMemory.search(undefined, 100),
      this.system.storage.tasks.list(),
      this.system.semanticMemory ? this.system.semanticMemory.list().then((records) => records.slice(0, 100)) : Promise.resolve([]),
    ]);
    // P9.23: semantic memory inspection is metadata + content by explicit
    // record (same authority as the canonical store); payloads redacted at
    // the boundary like every other memory surface.
    this.writeJson(response, 200, {
      readOnly: true,
      mission: missionMemory,
      evidence: evidenceMemory,
      decisions: this.system.decisionMemory.getAllDecisions(),
      failures: this.events.filter((event) => event.type.endsWith(".failed")),
      skills: this.system.skills.getAll().map((skill) => ({ id: skill.id, version: skill.manifest.version, status: skill.status, useCount: skill.useCount })),
      recipes: this.system.recipes.listRecipes(),
      identity: identityMemory,
      tasks,
      semantic: {
        records: semantic.map((record) => JSON.parse(redactSecrets(JSON.stringify({
          memoryId: record.memoryId,
          scope: record.scope,
          owner: record.owner,
          contentPreview: record.content.length > 200 ? `${record.content.slice(0, 200)}...` : record.content,
          contentHash: record.contentHash,
          provenance: record.provenance,
          lifecycle: record.lifecycle,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          embedding: record.embedding ? {
            providerId: record.embedding.providerId,
            model: record.embedding.model,
            embeddingVersion: record.embedding.embeddingVersion,
            dimensions: record.embedding.dimensions,
          } : null,
        }))) as JsonObject),
        stats: this.system.semanticMemory ? JSON.parse(redactSecrets(JSON.stringify(this.system.semanticMemory.stats()))) as JsonObject : { recordCount: 0, embeddingsEnabled: false },
      },
    });
  }

  private settings(): JsonObject {
    const improvement = this.system.improvementCoordinator.getConfig();
    const researchAdapter = this.system.researchTool.getStatus();
    return {
      improvement: {
        enabled: improvement.enabled,
        autoEvaluate: improvement.autoEvaluate,
        minimumEvidence: improvement.minimumEvidence,
        cooldownMs: improvement.cooldownMs,
      },
      selfModification: {
        approvalRequired: true,
        worktreeIsolation: true,
        automaticMutation: false,
        automaticMerge: false,
      },
      researchAdapter: {
        enabled: researchAdapter.enabled,
        configured: researchAdapter.configured,
        timeoutMs: researchAdapter.timeoutMs,
        maxResults: researchAdapter.maxResults,
        maxOutputChars: researchAdapter.maxOutputChars,
      },
      safety: {
        permissions: [...this.system.config.permissions],
        providerCredentialsExposed: false,
      },
    };
  }

  private async updateSettings(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await this.readJson(request);
    if (!isSettingsPatch(body)) {
      this.writeError(response, 400, "settings.invalid_request", "Only validated improvement settings may be updated.");
      return;
    }
    if (body.selfModificationApprovalRequired === false) {
      this.writeError(response, 409, "settings.approval_required", "Self-modification approval cannot be disabled through Studio.");
      return;
    }
    if (body.improvement) this.system.improvementCoordinator.updateConfig(body.improvement);
    this.writeJson(response, 200, this.settings());
  }

  private streamEvents(request: IncomingMessage, response: ServerResponse): void {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write(": connected\n\n");
    const detach = this.system.events.onAny((event) => {
      if (!response.writableEnded) response.write(formatSse(event));
    });
    this.streamClients.add(response);
    request.on("close", () => {
      detach();
      this.streamClients.delete(response);
    });
  }

  private health(): JsonObject {
    return {
      ok: true,
      service: "quack-api-server",
      activeMissions: [...this.missions.values()].filter((mission) => mission.state === "RUNNING" || mission.state === "QUEUED").length,
      skills: this.system.skills.count(),
      agents: this.system.workforce.registry.list().length,
      dataDir: this.system.config.dataDir,
      workspaceRoot: this.system.config.workspaceRoot,
    };
  }

  private async getDashboardState(response: ServerResponse): Promise<void> {
    const [traces, evaluations] = await Promise.all([
      this.system.storage.traces.list(),
      this.system.storage.evaluations.list(),
    ]);
    this.writeJson(response, 200, buildDashboardState({
      missions: this.listMissionRecords(),
      agents: this.system.workforce.registry.list(),
      skills: this.system.skills.getAll(),
      traces,
      evaluations,
      events: this.events,
    }));
  }

  private listMissionRecords(): ApiMissionRecord[] {
    const records = [...this.missions.values()];
    const existingMissionIds = new Set(records.flatMap((record) => record.missionId ? [record.missionId] : []));
    for (const mission of this.system.cognitiveSystem.missionManager.getAll()) {
      if (existingMissionIds.has(mission.id)) continue;
      records.push({
        id: mission.id,
        state: stateFromMissionStatus(mission.status),
        goal: `${mission.name}: ${mission.description}`,
        actor: mission.owner,
        missionId: mission.id,
        iterations: 0,
        createdAt: mission.createdAt,
        updatedAt: mission.completedAt ?? mission.createdAt,
      });
    }
    return records.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }

  private statusFromRecord(record: ApiMissionRecord): MissionStatus {
    return {
      missionId: record.missionId,
      loopId: record.id,
      state: record.state,
      iterations: record.iterations,
      error: record.error,
    };
  }

  private updateMission(id: string, patch: Partial<ApiMissionRecord>): void {
    const existing = this.missions.get(id);
    if (!existing) return;
    this.missions.set(id, {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  }

  private async readJson(request: IncomingMessage): Promise<unknown> {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buffer.byteLength;
      if (size > this.requestBodyLimitBytes) {
        throw new HttpError(413, "request.too_large", "Request body exceeds the configured size limit.");
      }
      chunks.push(buffer);
    }
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (!raw) return {};
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new HttpError(400, "request.invalid_json", "Request body must be valid JSON.");
    }
  }

  private async readOptionalJson(request: IncomingMessage): Promise<unknown> {
    const length = request.headers["content-length"];
    if (length === undefined || length === "0") return {};
    return this.readJson(request);
  }

  private writeJson(response: ServerResponse, status: number, payload: unknown): void {
    if (response.headersSent) return;
    const body = JSON.stringify(payload, null, 2);
    if (Buffer.byteLength(body, "utf8") > this.responseBodyLimitBytes) {
      const limited = JSON.stringify({ error: { code: "response.too_large", message: "Response exceeds the configured size limit.", status: 507 } });
      response.writeHead(507, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(limited) });
      response.end(limited);
      return;
    }
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
    response.end(body);
  }

  private writeText(response: ServerResponse, status: number, payload: string, contentType: string): void {
    if (response.headersSent) return;
    if (Buffer.byteLength(payload, "utf8") > this.responseBodyLimitBytes) throw new HttpError(507, "response.too_large", "Response exceeds the configured size limit.");
    response.writeHead(status, { "Content-Type": contentType, "Content-Length": Buffer.byteLength(payload) });
    response.end(payload);
  }

  private writeError(response: ServerResponse, status: number, code: string, message: string): void {
    this.writeJson(response, status, { error: { code, message, status } } satisfies ApiErrorResponse);
  }

  private async listActions(response: ServerResponse): Promise<void> {
    const providers = await Promise.all(this.system.actionProviders.list().map(async (provider) => {
      const metadata = provider.metadata();
      const [health, actions] = await Promise.all([
        provider.health().catch((error) => ({ status: "OFFLINE" as const, checkedAt: new Date().toISOString(), message: error instanceof Error ? error.message : String(error) })),
        provider.discoverActions().catch(() => []),
      ]);
      return { metadata, health, actions };
    }));
    const executions = await this.system.storage.actionExecutions.list(100);
    this.writeJson(response, 200, {
      providers,
      executions,
      ambiguous: executions.filter((record) => ["EXECUTING", "UNKNOWN_EXTERNAL_STATE", "RECONCILING"].includes(record.state)),
      note: "Action results may be inspected here; secrets and approval credentials are never returned.",
    });
  }

  private async listMcpServers(response: ServerResponse): Promise<void> {
    const servers = await Promise.all(this.system.mcpServers.list().map(async (server) => ({
      metadata: server.metadata(),
      enabled: server.isEnabled(),
      health: await server.health(),
    })));
    this.writeJson(response, 200, { servers, supportedTransports: ["stdio", "streamable-http"], legacySse: false });
  }

  private async getSystemStatus(response: ServerResponse): Promise<void> {
    const actions = await this.system.storage.actionExecutions.list(500);
    this.writeJson(response, 200, {
      runtime: this.health(),
      setup: {
        nvidia: process.env["NVIDIA_API_KEY"] ? "AVAILABLE" : "NEEDS_SETUP",
        ollama: this.system.providers.list().includes("ollama") ? "AVAILABLE" : "NEEDS_SETUP",
        browser: this.system.browser.metadata().boundary === "local" ? "AVAILABLE" : "UNAVAILABLE",
      },
      safety: {
        networkDefault: "DENY",
        loopbackOnly: isLoopbackHost(this.host),
        authentication: this.authentication,
        csrfProtection: true,
      },
      actions: {
        total: actions.length,
        awaitingApproval: actions.filter((record) => record.state === "AWAITING_APPROVAL").length,
        ambiguous: actions.filter((record) => ["EXECUTING", "UNKNOWN_EXTERNAL_STATE", "RECONCILING"].includes(record.state)).length,
      },
      mcp: { configured: this.system.mcpServers.list().length },
    });
  }

  private applySecureHeaders(response: ServerResponse): void {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    response.setHeader("Cache-Control", "no-store");
  }

  private enforceRateLimit(request: IncomingMessage): void {
    const key = request.socket.remoteAddress ?? "unknown";
    const current = Date.now();
    const window = this.rateWindows.get(key);
    if (!window || current - window.startedAt >= 60_000) {
      this.rateWindows.set(key, { startedAt: current, count: 1 });
      return;
    }
    window.count += 1;
    if (window.count > this.rateLimitPerMinute) throw new HttpError(429, "request.rate_limited", "Local API rate limit exceeded.");
  }

  private validateHost(request: IncomingMessage): void {
    const raw = request.headers.host ?? "";
    let hostname: string;
    try { hostname = new URL(`http://${raw}`).hostname.replace(/^\[|\]$/g, "").toLowerCase(); }
    catch { throw new HttpError(400, "request.invalid_host", "Host header is invalid."); }
    if (!isLoopbackHost(hostname) && hostname !== this.host.toLowerCase()) throw new HttpError(403, "request.host_denied", "Host header is not allowed.");
  }

  private validateOrigin(request: IncomingMessage): void {
    const origin = request.headers.origin;
    if (!origin) return;
    const own = this.address().url;
    if (origin !== own && !this.allowedOrigins.has(origin)) throw new HttpError(403, "request.origin_denied", "Cross-origin access to QUACK is denied.");
  }

  private requireAuthentication(request: IncomingMessage, method: string): void {
    if (!this.authentication) return;
    const authorization = request.headers.authorization;
    const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
    const cookie = parseCookie(request.headers.cookie ?? "", "quack_session");
    if (!safeEqual(bearer ?? cookie ?? "", this.authToken)) throw new HttpError(401, "request.unauthorized", "A valid local QUACK session is required.");
    if (method !== "GET" && method !== "HEAD" && cookie && request.headers["x-quack-csrf"] !== "1") {
      throw new HttpError(403, "request.csrf_denied", "State-changing browser requests require the QUACK CSRF header.");
    }
  }

  private issueDashboardSession(response: ServerResponse): void {
    if (!this.authentication) return;
    response.setHeader("Set-Cookie", `quack_session=${encodeURIComponent(this.authToken)}; HttpOnly; SameSite=Strict; Path=/`);
  }
}

export function createApiServer(config: ApiServerConfig = {}): QuackHttpServer {
  return new QuackHttpServer(config);
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function trimTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

function isPublicRoute(method: string, path: string): boolean {
  return method === "GET" && (path === "/health" || path === "/dashboard" || path === "/dashboard/styles.css" || path === "/dashboard/app.js");
}

function parseCookie(header: string, name: string): string | undefined {
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface StudioMissionSubmission extends MissionSubmission {
  readonly mode?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly safetyMode?: string;
  readonly dryRun?: boolean;
}

function isMissionSubmission(value: unknown): value is StudioMissionSubmission {
  if (!isRecord(value)) return false;
  return typeof value["goal"] === "string" &&
    value["goal"].trim().length > 0 &&
    (value["actor"] === undefined || typeof value["actor"] === "string") &&
    (value["missionId"] === undefined || typeof value["missionId"] === "string") &&
    (value["mode"] === undefined || typeof value["mode"] === "string") &&
    (value["providerId"] === undefined || typeof value["providerId"] === "string") &&
    (value["model"] === undefined || typeof value["model"] === "string") &&
    (value["safetyMode"] === undefined || typeof value["safetyMode"] === "string") &&
    (value["dryRun"] === undefined || typeof value["dryRun"] === "boolean");
}

function isSkillImportRequest(value: unknown): value is { readonly path: string } {
  return isRecord(value) && typeof value["path"] === "string" && value["path"].trim().length > 0;
}

function isOptionalVersionRequest(value: unknown): value is { readonly version?: string } {
  return isRecord(value) && (value["version"] === undefined || typeof value["version"] === "string");
}

function isProposalDecisionRequest(value: unknown): value is { readonly confirm: true; readonly actor: string; readonly reason?: string } {
  return isRecord(value) && value["confirm"] === true && typeof value["actor"] === "string" && value["actor"].trim().length > 0 &&
    (value["reason"] === undefined || typeof value["reason"] === "string");
}

function isApprovalDecisionRequest(value: unknown): value is { readonly actor: string; readonly reason?: string } {
  return isRecord(value) && typeof value["actor"] === "string" && value["actor"].trim().length > 0 &&
    (value["reason"] === undefined || typeof value["reason"] === "string");
}

function isModelStreamRequest(value: unknown): value is { readonly prompt: string; readonly actor: string; readonly model?: string; readonly missionId?: string } {
  return isRecord(value) && typeof value["prompt"] === "string" && value["prompt"].trim().length > 0 &&
    typeof value["actor"] === "string" && value["actor"].trim().length > 0 &&
    (value["model"] === undefined || typeof value["model"] === "string") &&
    (value["missionId"] === undefined || typeof value["missionId"] === "string");
}

function isRecipeCategory(value: string): value is AppRecipeCategory {
  return ["rag_app", "agent_app", "multi_agent_app", "voice_agent", "browser_agent", "research_agent", "coding_agent", "data_analysis_agent", "automation_agent", "robotics_agent", "startup_saas_agent"].includes(value);
}

function isRecipePlanRequest(value: unknown): value is { readonly targetStack: string } {
  return isRecord(value) && typeof value["targetStack"] === "string" && value["targetStack"].trim().length > 0;
}

function isProviderTestRequest(value: unknown): value is { readonly providerId: string } {
  return isRecord(value) && typeof value["providerId"] === "string" && value["providerId"].trim().length > 0;
}

interface SettingsPatch {
  readonly improvement?: {
    readonly enabled?: boolean;
    readonly autoEvaluate?: boolean;
    readonly minimumEvidence?: number;
    readonly cooldownMs?: number;
  };
  readonly selfModificationApprovalRequired?: boolean;
}

function isSettingsPatch(value: unknown): value is SettingsPatch {
  if (!isRecord(value)) return false;
  if (value["selfModificationApprovalRequired"] !== undefined && typeof value["selfModificationApprovalRequired"] !== "boolean") return false;
  const improvement = value["improvement"];
  if (improvement === undefined) return true;
  if (!isRecord(improvement)) return false;
  return (improvement["enabled"] === undefined || typeof improvement["enabled"] === "boolean") &&
    (improvement["autoEvaluate"] === undefined || typeof improvement["autoEvaluate"] === "boolean") &&
    (improvement["minimumEvidence"] === undefined || (typeof improvement["minimumEvidence"] === "number" && Number.isFinite(improvement["minimumEvidence"]) && improvement["minimumEvidence"] >= 0)) &&
    (improvement["cooldownMs"] === undefined || (typeof improvement["cooldownMs"] === "number" && Number.isFinite(improvement["cooldownMs"]) && improvement["cooldownMs"] >= 0));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatSse(event: QuackEvent): string {
  // Redaction happens at the wire boundary: payload strings are scrubbed
  // before crossing SSE, so credentials never reach a client stream. Key
  // redaction mirrors src/recovery/backup.ts; string redaction reuses
  // redactSecrets. JSON stays valid (replacements are plain literals).
  const data = JSON.stringify({ ...event, payload: redactEventPayload(event.payload) });
  return [
    `id: ${event.id}`,
    `event: ${event.type}`,
    `data: ${data}`,
    "",
    "",
  ].join("\n");
}

function redactEventPayload(value: unknown): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactEventPayload);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      isSecretEventKey(key) ? "[REDACTED]" : redactEventPayload(item),
    ]));
  }
  return value;
}

function isSecretEventKey(key: string): boolean {
  return /(?:^|_)(?:key|token|secret|password|passwd|credential|credentials|apikey|authorization|cookie)$/i.test(key) || /^.*_API_KEY$/i.test(key);
}

function stateFromMissionStatus(status: string): ApiMissionRecord["state"] {
  if (status === "completed") return "COMPLETED";
  if (status === "failed") return "FAILED";
  if (status === "active") return "RUNNING";
  return "QUEUED";
}
