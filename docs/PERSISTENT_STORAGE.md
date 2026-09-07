# Persistent Storage

QUACK OS v1.1 uses a repository-backed storage layer for durable mission state.
Business logic depends on repository interfaces; SQLite calls stay inside
`src/storage/sqlite.ts`.

## Default Store

The default system composition creates:

```text
dataDir/
  quack.sqlite
  tasks.json
```

`quack.sqlite` is the primary store. `tasks.json` remains as a compatibility
mirror for existing runtime tooling that reads task history directly.

## Repositories

The storage bundle exposes:

- `missions`: mission definitions and lifecycle status.
- `tasks`: runtime tasks and results.
- `traces`: harness mission traces.
- `evaluations`: harness mission evaluation results.
- `memory`: legacy runtime memory records.
- `memoryItems`: Memory OS v1 memory items and policies.

## Migrations

`SqliteConnection` runs migrations before repository operations. Applied
migrations are recorded in `quack_migrations`, allowing future schema changes
without pushing database details into runtime, agent, harness, or memory logic.

## Integration

`createQuackSystem()` wires the SQLite repositories through dependency
injection:

- `MissionManager` receives a mission repository.
- `QuackRuntime` receives a task store.
- `MemoryManager` receives a Memory OS storage adapter.
- `TraceRecorder` and `MissionEvaluator` receive trace/evaluation repositories.
- `QuackApi` persists trace and evaluation lookup records by loop id.

The Capability Broker, Skill Runtime sandbox, Agent Loop lifecycle, Harness
tracing, and Event Bus observability boundaries are unchanged.
