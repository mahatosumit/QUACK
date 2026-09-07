# ADR 0024: Architecture Governance & Constitution Compliance Framework

* **Status:** Accepted
* **Date:** 2026-07-25
* **Author:** QUACK Architecture Board
* **Deciders:** Chief System Architect, Principal Software Architect, Runtime Architect, Security Architect, Performance Engineer

---

## Context

QUACK OS operates under the `ARCHITECTURE_CONSTITUTION.md` master directivives, demanding strict provider neutrality, domain neutrality, layered dependency direction, zero upward coupling, and full architectural auditability across all 9 system layers (Core, Runtime, Intelligence, Engine, Agent, System, Platform, AI, Extension).

As QUACK OS scales to version 1.0.0 and beyond, continuous automated governance and strict adherence to the 20-stage Architecture Governance Pipeline must be codified as first-class architectural artifacts.

## Decision

We establish **ADR 0024: Architecture Governance & Constitution Compliance Framework**.

### 1. Mandatory 20-Stage Governance Pipeline Integration
Every future subsystem modification, architectural proposal, or feature extension must undergo and pass the 20-stage pipeline:
1. Requirement Analysis
2. Existing Capability Audit
3. Gap Analysis
4. Reference Comparison
5. Architecture Review
6. Dependency Analysis
7. Performance Analysis
8. Security Analysis
9. Scalability Analysis
10. Maintainability Analysis
11. Compatibility Review
12. Migration Planning
13. RFC Generation
14. ADR Generation
15. Implementation Plan
16. Validation
17. Implementation
18. Regression Testing
19. Documentation Update
20. Architecture Revalidation

### 2. Knowledge Graph Analysis Requirement
All architectural queries, relationship audits, and dependency tracing MUST utilize `graphify` (AST & Knowledge Graph analysis) to ensure precise mapping of symbols, god nodes, and cross-module call flows before any modification.

### 3. Core Layer Guardrails
- Upward imports from `src/core` to higher layers (`src/cos`, `src/airm`, `src/desktop`, etc.) remain strictly prohibited.
- Third-party AI provider SDKs are disallowed in core modules. All provider interactions must pass through `ProviderInterface` or `AiRuntimeManager`.

### 4. Test Quality Standard
- Unit test assertions must strictly mirror domain lifecycle invariants (e.g., goals must transition through `draft` -> `active` -> `completed`).

## Status & Consequences

* **Positive**: Enforces rigorous engineering standards, prevents architectural drift, guarantees long-term extensibility and backward compatibility.
* **Negative**: Requires formal RFC/ADR documentation and 20-stage pipeline approval for architectural modifications.
