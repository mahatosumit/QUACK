# ADR 0002: Persist Runtime State And Audit Events Locally

Status: Accepted

## Context

QUACK is local-first and observable. A runtime that only stores tasks in memory cannot support session history, recovery, debugging, or long-running agent workflows.

## Decision

Add a `TaskStore` abstraction with an in-memory implementation for tests and a JSON-file implementation for local runtime state. Add an `AuditLog` abstraction with an in-memory implementation and a JSONL file implementation. The initial default system composition writes tasks to `.quack/tasks.json` and audit events to `.quack/audit.jsonl`.

QUACK OS v1.1 extends this decision with a SQLite repository layer. The default composition now uses `.quack/quack.sqlite` as the primary store for missions, tasks, traces, evaluations, and memory, while keeping `.quack/tasks.json` as a compatibility mirror for existing task-history consumers.

## Consequences

The runtime can now survive process boundaries for task history and event inspection. SQLite becomes the production-oriented default without pushing database calls into mission, runtime, harness, or memory business logic. JSONL remains the audit log format, and the task JSON mirror remains for backward compatibility.
