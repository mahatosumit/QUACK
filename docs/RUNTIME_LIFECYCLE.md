# Runtime Lifecycle

The QUACK OS kernel initialization follows a strict phase-based lifecycle.

1. **Boot**: Load `quack.config.json` and initialize the Dependency Injection (DI) registry.
2. **Mount**: Initialize `WorkspaceManager`, mount virtual filesystem abstractions, and scan the repository to populate the `KnowledgeGraphStore`.
3. **Bind**: Register all core tools to `ToolRegistry` and default providers to `ProviderRegistry`.
4. **Agent Seed**: Load built-in roles (`SoftwareEngineerAgent`, `ArchitectureReviewer`) into the `AgentRegistry`.
5. **Execution**: The runtime yields to `WorkflowEngine` to await tasks.
6. **Teardown**: Cleanup depends on the selected entry point and component. No universal checkpoint flush, plugin unmount, or automatic restart-resume guarantee is established; interrupted side effects require reconciliation.
