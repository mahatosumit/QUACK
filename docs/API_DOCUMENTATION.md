# API Documentation

## QuackRuntime

The primary entry point to QUACK OS.

### `QuackRuntime.create(config: EngineConfig)`
Bootstraps the OS, initializes the DI container, and returns a `QuackRuntime` instance.

### `runtime.getWorkspaceManager()`
Returns the `WorkspaceManager` instance for safe file I/O.

### `runtime.getEventBus()`
Returns the global `EventBus` for subscribing to or emitting system events.

## ExecutiveBrain

### `brain.executeGoal(goal: string)`
Parses a human goal, delegates to the `WorkflowEngine`, and returns a Promise that resolves when the DAG completes.

## SessionRuntime

### `session.createSession()`
Initializes a durable session, allocating a unique ID and preparing the Checkpoint and Journal stores.

### `session.snapshot(sessionId)`
Takes a momentary snapshot of session state, pushing it onto the Undo stack.
