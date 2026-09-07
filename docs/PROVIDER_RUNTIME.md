# Provider runtime

> vNext migration: capability- and policy-aware execution uses
> `CanonicalProviderRegistry` plus `CapabilityProviderRouter`. The legacy
> registry remains available for compatibility and is not the source of native
> capability truth.

`QuackProviderV1` is the stable provider contract. Built-in legacy adapters include echo, OpenAI-compatible cloud endpoints, NVIDIA NIM, optional Ollama endpoints, optional vLLM endpoints, and `DeterministicMockProvider` for tests.

`ProviderFallbackRouter` tries only the caller's explicit ordered providers. No keys are stored in source; runtime configuration uses `QUACK_*` environment variables.
