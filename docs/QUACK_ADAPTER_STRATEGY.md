# Adapter strategy

External capabilities enter QUACK through stable contracts: `ProviderAdapter`, `ToolRegistry`, `CapabilityBroker`, `MemoryStore`, and `AppRecipeRegistry`.

Agent-Reach is registered as `external.agent-reach`, defaults to disabled, requires `network.http` through the runtime capability broker, and returns bounded normalized source metadata. LiteLLM, MCP, mem0, Graphiti, Ollama, and vLLM remain adapters rather than core runtime dependencies.
