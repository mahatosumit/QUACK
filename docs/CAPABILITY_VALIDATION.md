# Capability Validation Matrix

This is a source inventory, not a competitive benchmark or production
certification. Test-file presence does not establish a passing result. Run the
current suites and retain the tested revision and environment with their results.
The previous timing and complexity figures did not include reproducible evidence
and have been removed.

| Capability | Implementation | Relevant tests | Current limitation |
|---|---|---|---|
| Goal planning | `src/brain/executive-brain.ts` | `src/brain/executive-brain.test.ts` | Multiple orchestration paths remain; no canonical-path certification. |
| SWE patching | `src/intelligence/patch/patch-engine.ts` | `src/intelligence/patch/patch-engine.test.ts` | Domain-specific functionality; no universal AST safety claim. |
| Workflow execution | `src/engine/workflow-engine.ts` | `src/engine/workflow-engine.test.ts` | Durability and timeout semantics require path-specific validation. |
| Checkpoint recovery | `src/engine/checkpoint-system.ts` | `src/engine/session-runtime.test.ts` | Test success must be checked against the current revision. |
| Provider routing | `src/airm/airm.ts` | `src/airm/airm.test.ts` | Not every model call follows the same routing path. |
| Plugin loading | `src/plugins/loader.ts` | `src/plugins/loader.test.ts` | In-process trusted code; permission declarations are not OS isolation. |
| Memory | `src/memory/memory.ts` | `src/memory/memory.test.ts` | No native dense-vector engine is registered. |

See [Capability Registry](CAPABILITY_REGISTRY.md) for source references and
[Security Policy](../SECURITY.md) for security boundaries. Comparisons against
other runtimes require common workloads, measured results, and cited revisions;
no superiority conclusion is established here.
