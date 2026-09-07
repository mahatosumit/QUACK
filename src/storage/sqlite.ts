import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { createId, now, type IsoTimestamp, type JsonObject } from "../core/types.js";
import { type MissionDefinition } from "../cos/types.js";
import { type MissionEvaluationResult, type MissionTrace } from "../harness/types.js";
import { type MemoryRecord, type MemoryScope, type MemoryStore } from "../memory/memory.js";
import { type MemoryItem, type MemoryStorageAdapter } from "../memory/os.js";
import { type Task } from "../runtime/task.js";
import { type TaskStore } from "./task-store.js";
import { type ActionExecutionLedger, type ActionExecutionRecord } from "../actions/ledger.js";
import { type MissionCompanyRecordV1, type MissionCompanyRepository } from "../company/types.js";

type SqliteValue = string | number | null;
type SqliteRow = Record<string, unknown>;

interface SqliteStatement {
  run(...params: SqliteValue[]): unknown;
  get(...params: SqliteValue[]): SqliteRow | undefined;
  all(...params: SqliteValue[]): SqliteRow[];
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface SqliteModule {
  DatabaseSync: new (path: string) => SqliteDatabase;
}

export interface MissionRepository {
  save(mission: MissionDefinition): MissionDefinition;
  get(id: string): MissionDefinition | undefined;
  list(): MissionDefinition[];
  clear(): void;
}

export interface TraceRepository {
  save(trace: MissionTrace, options?: { readonly lookupId?: string }): Promise<MissionTrace>;
  get(id: string): Promise<MissionTrace | undefined>;
  list(query?: { readonly missionId?: string }): Promise<MissionTrace[]>;
}

export interface StoredMissionEvaluation {
  readonly id: string;
  readonly traceId?: string;
  readonly missionId?: string;
  readonly result: MissionEvaluationResult;
  readonly createdAt: IsoTimestamp;
}

export interface EvaluationRepository {
  save(record: StoredMissionEvaluation): Promise<StoredMissionEvaluation>;
  get(id: string): Promise<StoredMissionEvaluation | undefined>;
  list(query?: { readonly missionId?: string; readonly traceId?: string }): Promise<StoredMissionEvaluation[]>;
}

export interface QuackStorage {
  readonly missions: MissionRepository;
  readonly missionCompanies: MissionCompanyRepository;
  readonly tasks: TaskStore;
  readonly traces: TraceRepository;
  readonly evaluations: EvaluationRepository;
  readonly memory: MemoryStore;
  readonly memoryItems: MemoryStorageAdapter;
  readonly actionExecutions: ActionExecutionLedger;
}

export class SqliteMissionCompanyRepository implements MissionCompanyRepository {
  constructor(private readonly connection: SqliteConnection) {}

  save(record: MissionCompanyRecordV1): MissionCompanyRecordV1 {
    return this.connection.withDatabase((database) => {
      database.exec("begin immediate");
      try {
        const existing = database.prepare("select revision from mission_companies where mission_id = ?").get(record.missionId);
        const storedRevision = existing ? Number(existing["revision"]) : 0;
        if (record.revision !== storedRevision + 1) {
          throw new Error(`Mission company ${record.missionId} revision conflict: expected ${storedRevision + 1}, received ${record.revision}.`);
        }
        database.prepare(
          "insert or replace into mission_companies (mission_id, revision, state, outcome, updated_at, payload) values (?, ?, ?, ?, ?, ?)",
        ).run(record.missionId, record.revision, record.state, record.outcome ?? null, record.updatedAt, encode(record));
        database.exec("commit");
        return clone(record);
      } catch (error) {
        database.exec("rollback");
        throw error;
      }
    });
  }

  get(missionId: string): MissionCompanyRecordV1 | undefined {
    return this.connection.withDatabase((database) => {
      const row = database.prepare("select payload from mission_companies where mission_id = ?").get(missionId);
      return row ? decode<MissionCompanyRecordV1>(row["payload"]) : undefined;
    });
  }

  list(): MissionCompanyRecordV1[] {
    return this.connection.withDatabase((database) => database.prepare(
      "select payload from mission_companies order by updated_at desc",
    ).all().map((row) => decode<MissionCompanyRecordV1>(row["payload"])));
  }
}

export class SqliteConnection {
  constructor(private readonly filePath: string) {}

  withDatabase<T>(operation: (database: SqliteDatabase) => T): T {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const database = new databaseSync(this.filePath);
    try {
      database.exec("pragma busy_timeout = 10000;");
      runMigrations(database);
      return operation(database);
    } finally {
      database.close();
    }
  }
}

export class SqliteMissionRepository implements MissionRepository {
  constructor(private readonly connection: SqliteConnection) {}

  save(mission: MissionDefinition): MissionDefinition {
    return this.connection.withDatabase((database) => {
      database.prepare(
        "insert or replace into missions (id, status, canonical_state, created_at, updated_at, payload) values (?, ?, ?, ?, ?, ?)",
      ).run(mission.id, mission.status, mission.canonicalState ?? null, mission.createdAt, mission.completedAt ?? mission.createdAt, encode(mission));
      return clone(mission);
    });
  }

  get(id: string): MissionDefinition | undefined {
    return this.connection.withDatabase((database) => {
      const row = database.prepare("select payload from missions where id = ?").get(id);
      return row ? decode<MissionDefinition>(row["payload"]) : undefined;
    });
  }

  list(): MissionDefinition[] {
    return this.connection.withDatabase((database) => database.prepare("select payload from missions order by created_at").all()
      .map((row) => decode<MissionDefinition>(row["payload"])));
  }

  clear(): void {
    this.connection.withDatabase((database) => {
      database.prepare("delete from missions").run();
    });
  }
}

export class SqliteTaskStore implements TaskStore {
  constructor(private readonly connection: SqliteConnection) {}

  async save(task: Task): Promise<Task> {
    return this.connection.withDatabase((database) => {
      database.prepare(
        "insert or replace into tasks (id, status, created_at, updated_at, payload) values (?, ?, ?, ?, ?)",
      ).run(task.id, task.status, task.createdAt, task.updatedAt, encode(task));
      return clone(task);
    });
  }

  async get(id: string): Promise<Task | undefined> {
    return this.connection.withDatabase((database) => {
      const row = database.prepare("select payload from tasks where id = ?").get(id);
      return row ? decode<Task>(row["payload"]) : undefined;
    });
  }

  async list(): Promise<Task[]> {
    return this.connection.withDatabase((database) => database.prepare("select payload from tasks order by created_at").all()
      .map((row) => decode<Task>(row["payload"])));
  }
}

export class CompositeTaskStore implements TaskStore {
  constructor(
    private readonly primary: TaskStore,
    private readonly mirrors: readonly TaskStore[] = [],
  ) {}

  async save(task: Task): Promise<Task> {
    const saved = await this.primary.save(task);
    await Promise.all(this.mirrors.map((mirror) => mirror.save(saved)));
    return saved;
  }

  async get(id: string): Promise<Task | undefined> {
    return this.primary.get(id);
  }

  async list(): Promise<Task[]> {
    return this.primary.list();
  }
}

export class SqliteTraceRepository implements TraceRepository {
  constructor(private readonly connection: SqliteConnection) {}

  async save(trace: MissionTrace, options: { readonly lookupId?: string } = {}): Promise<MissionTrace> {
    return this.connection.withDatabase((database) => {
      database.prepare(
        "insert or replace into traces (id, lookup_id, mission_id, completed_at, payload) values (?, ?, ?, ?, ?)",
      ).run(trace.id, options.lookupId ?? null, trace.missionInput.missionId ?? null, trace.completedAt, encode(trace));
      return clone(trace);
    });
  }

  async get(id: string): Promise<MissionTrace | undefined> {
    return this.connection.withDatabase((database) => {
      const row = database.prepare("select payload from traces where id = ? or lookup_id = ? limit 1").get(id, id);
      return row ? decode<MissionTrace>(row["payload"]) : undefined;
    });
  }

  async list(query: { readonly missionId?: string } = {}): Promise<MissionTrace[]> {
    return this.connection.withDatabase((database) => {
      const rows = query.missionId
        ? database.prepare("select payload from traces where mission_id = ? order by completed_at").all(query.missionId)
        : database.prepare("select payload from traces order by completed_at").all();
      return rows.map((row) => decode<MissionTrace>(row["payload"]));
    });
  }
}

export class SqliteEvaluationRepository implements EvaluationRepository {
  constructor(private readonly connection: SqliteConnection) {}

  async save(record: StoredMissionEvaluation): Promise<StoredMissionEvaluation> {
    return this.connection.withDatabase((database) => {
      database.prepare(
        "insert or replace into evaluations (id, trace_id, mission_id, success, score, created_at, payload) values (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        record.id,
        record.traceId ?? null,
        record.missionId ?? null,
        record.result.success ? 1 : 0,
        record.result.score,
        record.createdAt,
        encode(record),
      );
      return clone(record);
    });
  }

  async get(id: string): Promise<StoredMissionEvaluation | undefined> {
    return this.connection.withDatabase((database) => {
      const row = database.prepare("select payload from evaluations where id = ?").get(id);
      return row ? decode<StoredMissionEvaluation>(row["payload"]) : undefined;
    });
  }

  async list(query: { readonly missionId?: string; readonly traceId?: string } = {}): Promise<StoredMissionEvaluation[]> {
    return this.connection.withDatabase((database) => {
      if (query.missionId) {
        return database.prepare("select payload from evaluations where mission_id = ? order by created_at")
          .all(query.missionId)
          .map((row) => decode<StoredMissionEvaluation>(row["payload"]));
      }
      if (query.traceId) {
        return database.prepare("select payload from evaluations where trace_id = ? order by created_at")
          .all(query.traceId)
          .map((row) => decode<StoredMissionEvaluation>(row["payload"]));
      }
      return database.prepare("select payload from evaluations order by created_at").all()
        .map((row) => decode<StoredMissionEvaluation>(row["payload"]));
    });
  }
}

export class SqliteMemoryStore implements MemoryStore {
  constructor(private readonly connection: SqliteConnection) {}

  async write(record: Omit<MemoryRecord, "id" | "createdAt">): Promise<MemoryRecord> {
    const stored: MemoryRecord = {
      ...record,
      id: createId("memory"),
      createdAt: now(),
    };
    return this.connection.withDatabase((database) => {
      database.prepare(
        "insert into memory_records (id, scope, created_at, payload) values (?, ?, ?, ?)",
      ).run(stored.id, stored.scope, stored.createdAt, encode(stored));
      return clone(stored);
    });
  }

  async search(query: { readonly scope?: MemoryScope; readonly text?: string; readonly limit?: number }): Promise<MemoryRecord[]> {
    return this.connection.withDatabase((database) => {
      const rows = query.scope
        ? database.prepare("select payload from memory_records where scope = ? order by created_at desc").all(query.scope)
        : database.prepare("select payload from memory_records order by created_at desc").all();
      const normalized = query.text?.toLowerCase();
      return rows
        .map((row) => decode<MemoryRecord>(row["payload"]))
        .filter((record) => normalized ? record.content.toLowerCase().includes(normalized) : true)
        .slice(0, query.limit ?? 20);
    });
  }
}

export class SqliteMemoryStorageAdapter implements MemoryStorageAdapter {
  constructor(private readonly connection: SqliteConnection) {}

  async save(item: MemoryItem): Promise<void> {
    this.connection.withDatabase((database) => {
      database.prepare(
        "insert or replace into memory_items (id, type, source, timestamp, related_mission, payload) values (?, ?, ?, ?, ?, ?)",
      ).run(item.id, item.type, item.source, item.timestamp, item.relatedMission ?? null, encode(item));
    });
  }

  async list(): Promise<MemoryItem[]> {
    return this.connection.withDatabase((database) => database.prepare("select payload from memory_items order by timestamp desc").all()
      .map((row) => decode<MemoryItem>(row["payload"])));
  }
}

export class SqliteActionExecutionLedger implements ActionExecutionLedger {
  constructor(private readonly connection: SqliteConnection) {}

  async save(record: ActionExecutionRecord): Promise<ActionExecutionRecord> {
    return this.connection.withDatabase((database) => {
      database.prepare(`insert or replace into action_execution_ledger
        (execution_id, mission_id, action_provider, action_name, idempotency_key, request_hash, risk_level, state, updated_at, payload)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(record.executionId, record.missionId, record.actionProvider, record.actionName, record.idempotencyKey ?? null,
          record.requestHash, record.riskLevel, record.state, record.updatedAt, encode(record));
      return clone(record);
    });
  }

  async get(executionId: string): Promise<ActionExecutionRecord | undefined> {
    return this.connection.withDatabase((database) => {
      const row = database.prepare("select payload from action_execution_ledger where execution_id = ?").get(executionId);
      return row ? decode<ActionExecutionRecord>(row["payload"]) : undefined;
    });
  }

  async findByIdempotency(providerId: string, actionId: string, idempotencyKey: string): Promise<ActionExecutionRecord | undefined> {
    return this.connection.withDatabase((database) => {
      const row = database.prepare(`select payload from action_execution_ledger
        where action_provider = ? and action_name = ? and idempotency_key = ? order by updated_at desc limit 1`)
        .get(providerId, actionId, idempotencyKey);
      return row ? decode<ActionExecutionRecord>(row["payload"]) : undefined;
    });
  }

  async listAmbiguous(): Promise<readonly ActionExecutionRecord[]> {
    return this.connection.withDatabase((database) => database.prepare(
      "select payload from action_execution_ledger where state in ('EXECUTING', 'UNKNOWN_EXTERNAL_STATE', 'RECONCILING') order by updated_at",
    ).all().map((row) => decode<ActionExecutionRecord>(row["payload"])));
  }

  async list(limit = 100): Promise<readonly ActionExecutionRecord[]> {
    return this.connection.withDatabase((database) => database.prepare(
      "select payload from action_execution_ledger order by updated_at desc limit ?",
    ).all(Math.max(1, Math.min(limit, 500))).map((row) => decode<ActionExecutionRecord>(row["payload"])));
  }
}

export function createSqliteStorage(filePath: string): QuackStorage {
  const connection = new SqliteConnection(filePath);
  return {
    missions: new SqliteMissionRepository(connection),
    missionCompanies: new SqliteMissionCompanyRepository(connection),
    tasks: new SqliteTaskStore(connection),
    traces: new SqliteTraceRepository(connection),
    evaluations: new SqliteEvaluationRepository(connection),
    memory: new SqliteMemoryStore(connection),
    memoryItems: new SqliteMemoryStorageAdapter(connection),
    actionExecutions: new SqliteActionExecutionLedger(connection),
  };
}

function runMigrations(database: SqliteDatabase): void {
  database.exec(`
    create table if not exists quack_migrations (
      id text primary key,
      applied_at text not null
    );
  `);

  const migrations = [
      {
        id: "001_persistent_mission_storage",
        sql: `
          create table if not exists missions (
            id text primary key,
            status text not null,
            canonical_state text,
            created_at text not null,
            updated_at text not null,
            payload text not null
          );
          create table if not exists tasks (
          id text primary key,
          status text not null,
          created_at text not null,
          updated_at text not null,
          payload text not null
        );
        create table if not exists traces (
          id text primary key,
          lookup_id text unique,
          mission_id text,
          completed_at text not null,
          payload text not null
        );
        create table if not exists evaluations (
          id text primary key,
          trace_id text,
          mission_id text,
          success integer not null,
          score real not null,
          created_at text not null,
          payload text not null
        );
        create table if not exists memory_records (
          id text primary key,
          scope text not null,
          created_at text not null,
          payload text not null
        );
        create table if not exists memory_items (
          id text primary key,
          type text not null,
          source text not null,
          timestamp text not null,
          related_mission text,
          payload text not null
        );
        create index if not exists idx_missions_status on missions(status);
        create index if not exists idx_tasks_status on tasks(status);
        create index if not exists idx_traces_mission on traces(mission_id);
        create index if not exists idx_evaluations_trace on evaluations(trace_id);
        create index if not exists idx_evaluations_mission on evaluations(mission_id);
        create index if not exists idx_memory_records_scope on memory_records(scope);
        create index if not exists idx_memory_items_mission on memory_items(related_mission);
      `,
    },
    {
      id: "002_durable_action_execution_ledger",
      sql: `
        create table if not exists action_execution_ledger (
          execution_id text primary key,
          mission_id text not null,
          action_provider text not null,
          action_name text not null,
          idempotency_key text,
          request_hash text not null,
          risk_level text not null,
          state text not null,
          updated_at text not null,
          payload text not null
        );
        create unique index if not exists idx_action_ledger_idempotency
          on action_execution_ledger(action_provider, action_name, idempotency_key)
          where idempotency_key is not null;
        create index if not exists idx_action_ledger_state on action_execution_ledger(state);
        create index if not exists idx_action_ledger_mission on action_execution_ledger(mission_id);
      `,
    },
    {
      id: "003_mission_company_runtime",
      sql: `
        create table if not exists mission_companies (
          mission_id text primary key,
          revision integer not null,
          state text not null,
          outcome text,
          updated_at text not null,
          payload text not null
        );
        create index if not exists idx_mission_companies_state on mission_companies(state);
      `,
    },
    {
      id: "004_coordination_leases",
      sql: `
        create table if not exists coordination_leases (
          resource_id text primary key,
          owner text not null,
          lease_expires_at integer not null,
          version integer not null,
          acquired_at integer not null,
          payload text
        );
      `,
    },
  ];

  // Migration application must be atomic across concurrently opening
  // processes: `begin immediate` serializes competing connections so the
  // check-then-insert cannot race (a plain check-then-insert lets two
  // processes both pass the check and both insert — UNIQUE failure).
  database.exec("begin immediate");
  try {
    for (const migration of migrations) {
      const existing = database.prepare("select id from quack_migrations where id = ?").get(migration.id);
      if (existing) continue;
      database.exec(migration.sql);
      database.prepare("insert into quack_migrations (id, applied_at) values (?, ?)").run(migration.id, now());
    }
    database.exec("commit");
  } catch (error) {
    database.exec("rollback");
    throw error;
  }
}

function encode(value: unknown): string {
  return JSON.stringify(value);
}

function decode<T>(value: unknown): T {
  return JSON.parse(String(value)) as T;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const require = createRequire(import.meta.url);
const { DatabaseSync: databaseSync } = require("node:sqlite") as SqliteModule;
