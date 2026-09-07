# Execution Flow

How a user goal becomes action in QUACK OS:

1. **Input**: User calls `brain.executeGoal("Fix the memory leak in auth.ts")`.
2. **Decomposition**: The `ExecutiveBrain` routes the goal to the `ArchitectureAnalyzer` to understand the domain.
3. **Graph Construction**: A `TaskGraph` (DAG) is generated containing discrete steps (e.g., *Read file*, *Analyze*, *Refactor*, *Test*).
4. **Delegation**: Nodes in the DAG are delegated to specific `AgentRole` instances on the `AgentCommunicationBus`.
5. **Execution**: 
   - The `AiRuntimeManager` selects the best provider for the task.
   - The agent invokes tools via the `PluginSandbox`.
   - The `WorkflowEngine` records `JournalEntry` metrics.
6. **Checkpoint**: Progress is flushed to disk via `JsonFileCheckpointStore`.
7. **Resolution**: Once all terminal DAG nodes succeed, the `ExecutiveBrain` returns a `QuackResult`.
