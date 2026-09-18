# QUACK Production Topology

**Version:** 1.0.0 — P16 deployment qualification

This document describes the ACTUAL qualified deployment topology, derived from
repository evidence and the P16 qualification suites. Every claim is classified
as IMPLEMENTED, BEST_EFFORT, UNSUPPORTED, or NOT_CLAIMED.

## Primary artifact

- **npm package `@quack/os`** — IMPLEMENTED.
  The distribution is a Node package installed with npm on the host OS
  (`files` manifest: `dist/`, installers, docs, start scripts; `bin: quack`
  → `dist/cli.js`). There is no Docker image, Dockerfile, or docker-compose
  artifact in this repository.

## Deployment model

- **Single-host, npm-primary installation** — IMPLEMENTED.
  One host, one Node process family, one local filesystem data directory
  (`dataDir`). The loopback-only authenticated HTTP server (QUACK Studio +
  Mission API) and the CLI share the dataDir.
- **Node >= 22.5** — IMPLEMENTED (`engines.node`).
  `node:sqlite` (SQLite coordination) requires >= 22.5.

## Application deployment vs execution isolation

| Concern | Surface | Classification |
|---|---|---|
| Application deployment | npm package on a single host | IMPLEMENTED |
| Execution isolation — OS process backend | child OS processes under the trusted IsolationSupervisor | IMPLEMENTED |
| Execution isolation — Docker container backend | used only when a Docker daemon exists in the environment | BEST_EFFORT (environment dependent; fails closed when unavailable) |
| Docker as application deployment artifact | none ships in this repository | UNSUPPORTED |

Docker is never a deployment method for QUACK itself. Where earlier
documentation suggested `docker compose up`, that claim was unsupported by
repository evidence and has been removed (see docs/DEPLOYMENT.md).

## Coordination model

- **SQLite lease coordination within one host** — IMPLEMENTED.
  `coordination.sqlite` in the dataDir provides fencing-epoch leases
  (`ACQUIRED` / `BUSY` / `TAKEOVER_STALE`, monotonic versions, 10s busy
  timeout, stale-lease takeover). Two processes sharing one dataDir can never
  both be the authoritative executor of one mission (P15, ADR 0049).
- **Multi-host / distributed coordination** — UNSUPPORTED.
  Single-host only. No distributed consensus, no HA.
- **Host-filesystem durability** — the local dataDir is the only durable
  store; its durability equals the host filesystem's guarantees.

## Network posture

- **Loopback-only server, authenticated by default** — IMPLEMENTED.
  The HTTP server refuses non-loopback binding; authentication defaults on
  (token generated at startup when not supplied).
- **Unrestricted network egress** — UNSUPPORTED.
  Network egress is policy-gated (default deny; explicit allowlists for
  configured provider endpoints only).

## Credential posture

- **Secrets** — IMPLEMENTED (fail-closed boundaries).
  Provider credentials enter only through the SecretProvider boundary from
  environment variables; they are never persisted to the dataDir, never
  included in backups, and redacted from events, audit, errors, and health
  surfaces (P16 SEC-1..10).
- **Unrestricted credential access for workloads** — UNSUPPORTED.
  Isolated workloads receive `credentials: NONE`; secret mediation across an
  isolation boundary fails closed on every backend.

## At-most-once execution

- **At-most-once dispatch per (mission, step, capability)** — IMPLEMENTED
  (durable step-attempt journal; AMBIGUOUS steps park, never re-execute).
- **Exactly-once external effects** — UNSUPPORTED.

## Related documents

- [DATA_LIFECYCLE.md](DATA_LIFECYCLE.md) — persistent data, backup/restore, migration
- [RELEASE_QUALIFICATION.md](RELEASE_QUALIFICATION.md) — criterion-by-criterion release decision
- [../DEPLOYMENT.md](../DEPLOYMENT.md) — operator installation/deployment guide
