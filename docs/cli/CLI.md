# QUACK CLI Reference

`quack` is the only supported entrypoint. Every command is a thin UI layer
over the canonical system:

```
quack command
   ↓
createQuackSystem → QuackRuntime → CapabilityBroker → governed execution
```

There is no second runtime or execution path behind the CLI.

## Global options

| Option | Effect |
| :--- | :--- |
| `--json` | Machine-readable JSON output for any command |
| `--config, -c <path>` | Explicit config file (wins over `~/.quack/config/config.json`) |
| `--workspace, -w <dir>` | Workspace root for this invocation |
| `--data-dir, -d <dir>` | Data directory for this invocation |
| `--port, -p <n>` | Desktop server port (`serve`) |
| `--headless` | Run without GUI |
| `--purge-data` | (`uninstall`) also remove `~/.quack` |
| `--help, -h` / `--version, -v` | Help / version |

## Exit codes

`0` success · `1` failure (mission failed, doctor found problems) · `2` usage error (missing goal, bad invocation)

## Configuration priority

```
CLI argument  >  QUACK_* environment variable  >  ~/.quack/config/config.json  >  default
```

Only explicitly allowlisted `QUACK_*` variables are read, one by one — never a
`process.env` spread:

| Variable | Overrides |
| :--- | :--- |
| `QUACK_HOME` | QUACK home root (default `~/.quack`) |
| `QUACK_DATA_DIR` | data directory |
| `QUACK_WORKSPACE_ROOT` | workspace root |
| `QUACK_LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` |
| `QUACK_SKILL_ROOTS` | comma/semicolon-separated skill roots |
| `QUACK_OWNERSHIP_LEASE_MS` | multi-process ownership lease duration |

## Commands

### quack init

Creates the QUACK home (`config/ data/ logs/ skills/ cache/ models/ runtime/`)
and writes a default `config/config.json` only when absent — never clobbers
user edits. Idempotent.

### quack doctor

Verifies runtime (Node, OS, arch, kernel), storage (SQLite writable,
workspace), recovery (coordination DB lease), security (CapabilityBroker,
network policy), and skills (registry). `--json` emits structured checks
with a `ready` boolean. Exit 1 when any check fails.

### quack status

Missions, tasks, skills, packages summary. Lists resumable interrupted tasks.

### quack run \<goal\>

Runs a goal as a governed mission. Exit 0 only when the mission completes.

### quack resume \<mission-id\>

Resumes an interrupted mission through ownership-lease recovery. Rejected
with `recovery.ownership_conflict` if another live process owns it.

### quack skills [list|search|install|enable|disable]

- `list` — registered skills + installed packages
- `search <query>` — scans configured skill roots (explicit, never whole-filesystem)
- `install <path>` — imports and registers a declarative skill package
- `enable|disable <id>` — toggles an installed package

### quack config

Shows effective configuration, its sources, priority order, and env allowlist.

### quack instructions [--mission \<id\>]

Lists governed-instruction dispatch records (P8.6, metadata-only: outcome,
digest, trust census, budget, defense-flag counts) from the stored trace
repository. `--mission <id>` filters via the existing trace-by-mission
lookup. `--json` emits machine-readable output. Records that fail
validation are excluded and counted — tampered records never render as
trustworthy. Instruction content is never stored or displayed.

### quack memory [list|inspect \<id\>|search \<query\>|delete \<id\>]

Inspects governed semantic memory (P9, ADR 0043) through the same
admission/authorization path as production. `list` shows records (scope,
owner, provenance, embedding state); `inspect` prints one record with full
provenance and a bounded content preview; `search` performs governed
semantic retrieval (requires an embedding-capable governed provider —
reported honestly otherwise); `delete` removes a record and its derived
index entries. `--json` machine output on every action. Exit codes: 0
success, 1 operational failure, 2 usage error, 3 not found / access
denied. Records that fail validation are excluded — tampered records never
render as trustworthy.

### quack extension [list|inspect|validate|install|enable|disable|remove]

Manages the governed extension ecosystem catalog (P10, ADR 0044) — a
declarative package registry, NOT an execution surface. Package content is
never executed, printed, or loaded by these commands.

- `list` — installed extensions with lifecycle, signature state, and
  integrity digest prefixes (metadata only); honest empty state
- `inspect <id>@<version>` — one extension with provenance, declared
  capabilities/permissions (declarations grant nothing), and integrity
  state
- `validate <dir>` — validates a package (`manifest.json` + content)
  against the fail-closed manifest contract and sha256 integrity
- `install <dir>` — installs a package through the broker-governed,
  transactional path (all-or-nothing; duplicate installs fail closed).
  `plugin.install` is HIGH-RISK policy, so install prompts the operator
  for approval before writing anything — a denial writes nothing.
- `enable|disable <id>@<version>` — explicit lifecycle transitions
  (invalid transitions fail closed)
- `remove <id>@<version>` — removes the extension and its registry entry
  (REMOVED is terminal; no ghost records)

Exit codes: 0 success, 1 operational failure (validation failure,
duplicate install, invalid transition), 2 usage error, 3 not found / access
denied. `--json` machine output on every action. Read-only commands
(`list`, `inspect`, `validate`) never prompt for approval.

### quack govmission [run|status]

Runs missions through the governed mission execution loop (P11, ADR 0045)
— the first model-in-the-loop path. Each iteration: canonical mission
state → QIE pipeline (privacy firewall, context selection, deterministic
composition, injection defense) → governed model dispatch → strict
fail-closed proposal parsing (`quack:action-proposal:v1`) → capability
broker authorization → execution through existing surfaces (ActionRuntime
or the policy-enforced core.tools path) → deterministic next-step policy.
The model proposes; the broker authorizes; the loop never executes
unauthorized actions and has no fallback execution path.

- `run "<objective>"` — executes a governed mission. Model dispatch is
  intrinsic, so the operator must declare the mission's permission set
  explicitly: `QUACK_GOVMISSION_PERMISSIONS="provider.invoke,workspace.read"`.
  `provider.invoke` is medium/high-risk policy — never granted implicitly;
  the declaration seeds the mission's capability grants (operator recorded
  as approver) and each run still confirms through the standard approval
  callback. Missions fail closed with `mission.model_error` when no model
  provider is reachable — output is never fabricated.
- `status [missionId]` — lists durable governed run records (missionId,
  state, stop reason, step count) or inspects one run with per-step
  metadata (capability, status, verification, decision, error code, plus
  the P12 execution state and isolation state — e.g.
  `EXECUTION_COMPLETED` under `POLICY_RESTRICTED`, honestly labeled as
  broker-policy enforcement, not a sandbox). Records persist under
  `<dataDir>/governed-missions/` and are visible across processes.

P12 (ADR 0046) hardening on the same path: every governed execution runs
under a server-derived ExecutionPolicy (runtime-owned timeout, output
containment, at-most-once dispatch, in-process concurrency bound). A step
that timed out, was cancelled, or crashed mid-dispatch settles AMBIGUOUS in
the durable step-attempt journal and is never re-executed — re-runs fail
closed. Missions that require an isolation level the runtime cannot
provide are DENIED (no silent downgrade).

Output is metadata-only — no prompts, no model output, no action
arguments, no secrets. Exit codes: 0 success (SUCCEEDED mission), 1
mission failure or operational error, 2 usage/consent error (missing
objective, missing provider.invoke declaration), 3 unknown mission.
`--json` machine output. Terminal runs refuse re-execution
(`mission.loop_already_terminal`) — start a new mission instead.

### quack update

Compares installed version against the npm registry (read-only `npm view`,
executed argv-only, no shell). Reports the upgrade command; never mutates
anything. User data is never touched by updates.

### quack uninstall

Explains npm removal; `--purge-data` removes the default `~/.quack` only.
Custom `QUACK_HOME` is never purged automatically.

### Advanced

- `mission` / `trace` / `evaluate` — run a mission with loop result / harness
  trace / harness evaluation output
- `agents` — list specialist agents
- `serve` — start the loopback-only authenticated desktop server
- `backup [path]` / `restore <path>` — verified, non-secret backup and
  atomic restore of the data directory
- `start <goal>` — default command when a goal is given without a verb

## Logs

Runtime logs live under `~/.quack/logs/`. Audit trail is append-only
(`~/.quack/data/`) and excluded from backups' sensitive paths when secret-like.
