# QUACK OS Capability Registry

This inventory identifies implementation locations. It is not a production
certification or competitive benchmark. The machine-readable source is
[CAPABILITY_REGISTRY.json](CAPABILITY_REGISTRY.json).

| ID | Name | Subsystem | Status | Production certified | Documentation |
|---|---|---|---|---|---|
| `cap-001` | Code patching and validation | SWE patch engine | Implemented | No | [ADR 0012](adr/0012-sea-editing-workflow.md) |
| `cap-002` | Durable workflow components | WorkflowEngine | Implemented | No | [ADR 0006](adr/0006-engine-workflow-runtime.md) |
| `cap-003` | Capability-based model routing | AIRM | Implemented | No | [ADR 0022](adr/0022-ai-runtime-manager.md) |
| `cap-004` | Structured audit logging | Telemetry | Implemented | No | [ADR 0002](adr/0002-persistent-runtime-state.md) |
| `cap-005` | Native vector similarity search | Memory | Planned | No | No implementation or RFC registered |
