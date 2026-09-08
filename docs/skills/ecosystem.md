# QUACK Skill Ecosystem

QUACK's capability ecosystem: how skills are created, discovered, analyzed, adapted, approved, installed, and executed — without ever breaking the governance model.

## The one rule

Every capability flows through exactly one path:

```
CLI → QuackRuntime → Planner → CapabilityBroker → Governed Tool Execution
    → Evidence → Verification → Receipt
```

There is no second execution path. Nothing in the ecosystem — external skills, reasoning policies, personas, generated skills — bypasses the CapabilityBroker or widens authority silently.

## Skill kinds

| Kind | What it is | Execution |
|---|---|---|
| `INSTRUCTION_ONLY` | Guidance/instructions (adapted external knowledge, reasoning policies) | Read-only grounding step; instructions never execute |
| `WORKFLOW` | Declarative step graph over governed tools | Sandboxed portable execution, per-step limits |
| `TOOL` | Tool port (MCP server, external integrations) | Behind the capability broker as a registered tool |
| `PLUGIN` / `PROVIDER` / `COMPOSITE` | Reserved (see ADR 0013/0014) | Per contract |

## Lifecycle

```
source (external repo | quack skill create | native pack)
  → static analysis (SkillAnalyzer)
  → risk classification (SkillClassifier)
  → security review (SkillSecurityReviewer: APPROVE / REVIEW / REJECT)
  → staging (SkillInstaller — declarative artifacts only, quarantined)
  → human approval (quack skills install <path> — validation + permission review)
  → activation (quack skills enable <id> — grant-checked)
  → execution (governed: broker preflight, sandbox, evidence)
  → retirement (quack skills disable <id> / remove)
```

### External repositories (Phase 7B)

`analyzeRepository` performs **read-only static analysis** of a local checkout:

- `SkillAnalyzer` — walks the repo (bounded: 400 files, 512KB/file), extracts manifests, skills, personas, dependencies, network/filesystem/secret requirements. CI/tests/docs findings are reported but downgraded; the adaptation surface is what carries BLOCKER severity.
- `SkillClassifier` — derives risk class (`LOW|MEDIUM|HIGH`) from *requirements*, never from claims; derives adaptability (`declarative | instructions-only | requires-tool-port | not-recommended`).
- `SkillSecurityReviewer` — verdict `APPROVE_CANDIDATE | REVIEW_REQUIRED | REJECT` from blockers, warnings, harvesting signals.
- `SkillAdapter` — proposes an instruction-only or workflow adaptation. External code is **never executed or copied as executable**.
- `SkillInstaller` — writes a candidate package (manifest, analysis, workflow) into a staging directory. Quarantine until the human approval flow runs.

Malicious patterns are detected and blocked at analysis time: shell injection, prompt injection (BLOCKER even in prose), credential harvesting, eval/dynamic Function, hidden network/telemetry, elevated shells, secret-shaped literals, postinstall scripts.

Analyses of the five Phase 7C reference repositories live in `docs/skills/analyses/` as `skill-analysis.json` (purpose, dependencies, permissions, filesystem/network requirements, execution model, security risk, adaptation recommendation). Notable: `agency-agents` is **REJECTED** (prompt-injection blocker in a persona file); `Graft` and `codebase-memory-mcp` are MCP servers → `requires-tool-port`, never inline skills.

## Reasoning Capability Pack (Phase 7D)

Eight native governed reasoning policies in `skills/reasoning/`:

| Skill | Purpose |
|---|---|
| `reasoning.ultrathink` | Deep analysis mode: decompose fully before acting |
| `reasoning.skeptic` | Challenge assumptions; verify claims against evidence |
| `reasoning.mirror` | Self-review as an independent reviewer |
| `reasoning.punch` | Direct concise execution |
| `reasoning.no-yap` | Verbosity control |
| `reasoning.blind-spots` | Risk discovery: failure modes, security, data integrity |
| `reasoning.ooda` | Observe → Orient → Decide → Act loop |
| `reasoning.artifacts` | Structured, checkable output generation |

These are **not privileged agents**. Each is a declarative skill package: read-only grounding step, `permission.workspace.read` only, `deny-escalation: true`, no network, no secrets. They are selected automatically by the contextual skill selector when a goal matches their tags/triggers, and their policy text is carried verbatim into mission workflow nodes.

```bash
quack skills install skills/reasoning/ultrathink
quack skills enable reasoning.ultrathink
quack run "ultrathink: analyze this architecture"
```

Source of truth: `src/skills/reasoning/pack.ts` (generator), `skills/reasoning/` (materialized artifacts).

## Build Your Own Skill (Phase 7F)

```bash
quack skill create robotics-researcher
```

Scaffolds into the first configured skill root (`~/.quack/skills` by default):

```
robotics-researcher/
  skill.yaml          # identity + routing metadata (human contract)
  instructions.md     # operating instructions
  permissions.yaml    # permission declaration (least authority)
  risk-declaration.yaml  # required risk declaration — must be true
  manifest.json       # machine contract for the governed installer
  workflow.json       # declarative steps
  tests/              # evaluation fixtures
  README.md           # lifecycle instructions
```

Created skills are **not activated**. Activation requires explicit install + enable, which runs validation, permission review (every capability request is broker-checked), and leaves the skill disabled until the human approves.

## Security model summary

- Risk classes derived from requirements, not claims; HIGH always requires review.
- BLOCKER findings (injection, harvesting, obfuscation) → REJECT, no plan.
- Adapted packages never carry executable external code; workflow steps are read-only grounding.
- All installs broker-validate `requiredCapabilities`; denied → rejected before registration.
- Secrets flow only through `SecretProvider` with `secrets.read:<name>` broker authority; all report text is secret-redacted.

See `docs/security/external-skills.md` for the full threat model.
