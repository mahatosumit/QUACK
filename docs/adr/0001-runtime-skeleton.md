# ADR 0001: Start With A Provider-Independent Runtime Skeleton

Status: Accepted

## Context

QUACK must become an AI operating system, not a single chatbot or one-provider coding assistant. The first implementation needs to prove the architectural center: goals become tasks, tasks flow through a Brain, actions are observable, and providers/tools remain replaceable.

## Decision

Start with a TypeScript runtime package that has no runtime dependencies and exposes:

- Typed events.
- Runtime task lifecycle.
- Brain interface.
- Tool registry.
- Provider registry.
- Permission policy interface.
- Memory store interface.
- Plugin manifest types.

## Consequences

The first slice is not feature-rich, but it establishes the dependency direction. Applications, providers, tools, and future plugins can be added without rewriting the runtime core.

