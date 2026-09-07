# ADR 0004: Provider Layer Wiring And ExecutiveBrain Integration

Status: Accepted

## Context

Phase 1 established the core runtime skeleton with interfaces for Brain, tools, providers, memory, and permissions. However, the production Brain implementation (ExecutiveBrain) was never wired into the system composition root, and no real provider adapter existed. All tools except the workspace filesystem pair were implemented but not registered, leaving the runtime with stub-only capabilities.

## Decision

Complete the vertical slice by:

1. **Wire ExecutiveBrain** as the default Brain when a real LLM provider is configured (detected by checking for non-echo providers in the registry). Fall back to SimpleBrain when only the EchoProvider is present.

2. **Implement OpenAiCompatibleProvider** — a provider adapter that uses the native fetch API (no external SDK dependency) and is compatible with OpenAI, Ollama, Groq, Together AI, DeepSeek, and any OpenAI-compatible endpoint. Configured via environment variables (`QUACK_OPENAI_API_KEY`, `QUACK_OPENAI_BASE_URL`, `QUACK_OPENAI_MODEL`).

3. **Enhance ExecutiveBrain** to use providers for planning, reasoning, and reflection. Each method constructs a structured JSON prompt, calls the provider, parses the response, and falls back to deterministic heuristics on failure.

4. **Register all orphaned tools** — code search, workspace write, terminal execution, and git status — that were implemented but never connected to the tool registry.

5. **Implement JsonFileMemoryStore** as a durable memory backend that persists records to a JSON file, matching the pattern already used by JsonFileTaskStore.

## Consequences

- The system now has a working path from goal → provider-backed planning → execution → reflection when a real provider is configured.
- Provider independence is preserved: the OpenAiCompatibleProvider goes through the same ProviderAdapter interface as the EchoProvider.
- Environment-variable configuration avoids coupling to a particular secret store or keychain.
- 13 new tests (18 total) cover knowledge graph, memory persistence, SimpleBrain, and the full runtime lifecycle.
- The architecture file is updated to reflect current module inventory.

## Next Steps

- Add structured output support to the provider interface (currently JSON is parsed from text responses).
- Implement the coding-agent application layer that uses the runtime to make autonomous code changes.
- Add a local model provider (Ollama/Ollama-compatible) for offline operation.
