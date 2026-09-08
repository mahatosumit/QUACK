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
