# ADR 0034: Governed Plugin Hook Execution

## Status

Accepted — 2026-09-06

## Context

Plugin lifecycle hooks existed as a declared contract
(`PluginHookContribution`, `PluginHookKind`) but admission actively rejected
any hook with `extension.unsupported_hook` because no governed hook executor
existed. Executable plugin support was therefore declarative-only.

## Decision

### Admission accepts validated hooks declaratively

`ExtensionRegistry` admission (`normalizePlugin`) now validates hook shape —
a known `PluginHookKind` (`runtime`, `mission`, `session`, `model`, `tool`,
`capability`, `evidence`, `memory`, `evaluation`) and a function handler —
and admits hooks as frozen contributions. Admission never executes a
handler. Malformed hooks (unknown kind, non-function handler) fail closed
with `extension.invalid` before publication, and the handler array is
frozen without `structuredClone` so executable identity is preserved.

### GovernedHookExecutor

`src/extensions/hooks.ts` defines `GovernedHookExecutor`, the only path
through which an admitted hook runs:

- **Authority first.** Every manifest-declared permission of the owning
  plugin resolves through the `CapabilityBroker` as a capability request
  built by the existing `buildToolCapabilityRequest` factory, carrying the
  current mission/task/agent/skill/actor context. One denial fails closed
  with a `DENIED` dispatch record before the handler is contacted.
- **Attenuated inputs.** The handler receives only a deep-frozen event
  payload — never registries, brokers, host APIs, or authority. Attempted
  mutation of the payload throws inside the handler only.
- **Deterministic outcomes.** Every dispatch returns a
  `HookDispatchRecord` with plugin id/version, kind, mission/task/actor
  context, duration, and one of `EXECUTED`, `DENIED`, `FAILED`,
  `CANCELLED`, or `TIMED_OUT`. Handler failure, timeout (default 5 s),
  cancellation, and expired deadlines never crash the host.
- **Ordering.** `dispatchAll` runs hooks of one kind deterministically in
  registration order.

### Unsupported isolation unchanged

Hooks still execute in-process as observers. No sandbox/isolation is claimed;
plugins that require isolation remain rejected by the existing plugin
boundary. Admission provenance, profile ceilings, and restrictive policy
brokers are unchanged.

## Consequences

- Executable plugin hooks now run through governed authority instead of
  being impossible: admission → policy → capability attenuation → governed
  execution → deterministic record.
- Hooks cannot escalate authority: they receive no host surface, and
  permission denials are enforced by the broker before dispatch.
- The `extension.unsupported_hook` admission error no longer exists; the
  registry test was updated to pin the new contract (admission accepts
  well-formed hooks without executing them; malformed hooks fail closed).
- Hooks are event observers, not actors: they cannot alter runtime state,
  and their failures are contained.

## Verification

- `src/extensions/hooks.test.ts` (10 tests): capability resolution before
  execution with provenance records; denial never contacts the handler;
  multi-permission fail-closed; frozen payload (mutation throws); timeout
  determinism; handler failure containment; pre-execution cancellation;
  expired deadline; kind filtering with registration order; no host surface
  in the event payload.
- `src/extensions/registry.test.ts` updated: hooks admitted declaratively
  without execution, malformed hooks and grant-like contributions fail
  closed.
- Full repository suite: 1,327 ordinary tests + 17 serial tests, 0 failures
  (one timing flake in `skill-runtime` timeout test on first run, passing in
  isolation and rerun); root and SDK typechecks, build, and lint pass.