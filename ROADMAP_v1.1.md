# QUACK OS v1.1 Roadmap

This roadmap focuses exclusively on Platform Evolution, DX, and Ecosystem Scaling.

## 🟢 Stable (Released in v1.0)
- Durable DAG Workflow Engine (`cap-002`)
- AST-Based Multi-File Refactoring (`cap-001`)
- Dynamic LLM Routing (`cap-003`)
- Immutable Audit Logging (`cap-004`)

## 🟡 Planned (v1.1 Target)
- **Plugin Registry (CLI)**: Ability to install verified plugins via `quack install plugin <name>`.
- **GUI Visual Debugger**: A browser-based visualizer for tracking DAG execution and Agent communication in real-time. (Ref: User demand, DX focus).
- **Template Generators**: Automated scaffolding via `quack create provider` or `quack create skill`.

## 🟠 Experimental (v1.x Exploration)
- **Native Vector Similarity Search (`cap-005`)**: Integrating a lightweight local vector store for semantic context windows. (Ref: RFC-0004).
- **Multi-Node Clustering**: Running the `WorkflowEngine` distributed across multiple machines for high-throughput orchestration.

## 🔴 Rejected
- **Built-in Chat UI**: QUACK OS is an operating system layer, not a consumer chat wrapper. Ecosystem developers should build chat UIs on top of QUACK OS.
- **Hardcoding Provider Features**: Adding specific code to support one vendor's unique non-standard feature. All integrations must abstract through `AiCapability`.
