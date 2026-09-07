# Provider Runtime Comparison

Research date: 2026-08-15. Sources are upstream repositories, documentation,
release notes, and licenses. No source code was copied into QUACK.

| Project | Decision | License | Rationale |
|---|---|---|---|
| [LiteLLM](https://github.com/BerriAI/litellm) | ADOPT_AS_OPTIONAL_ADAPTER | MIT (verify the exact deployed artifact) | Broad OpenAI-compatible provider gateway and mature routing/error patterns. Python/runtime footprint and supply-chain history make it unsuitable as QUACK Core. Versions 1.82.7 and 1.82.8 were reported compromised in March 2026, so any future adapter must pin, attest, and scan artifacts. |
| [Portkey Gateway](https://github.com/Portkey-AI/gateway) | ADOPT_AS_OPTIONAL_ADAPTER | MIT | Small gateway surface with retry/fallback, guardrails, observability, and many providers. Keep hosted/enterprise policy and identity outside the kernel. |
| [TensorZero](https://github.com/tensorzero/tensorzero) | ADAPT_PATTERN_ONLY | Apache-2.0 | Strong separation of gateway, observability, evaluation, experimentation, and optimization. Its Rust/ClickHouse-oriented platform is larger than the local Windows kernel needs. |
| [Vercel AI SDK](https://github.com/vercel/ai) | ADAPT_PATTERN_ONLY | Apache-2.0 | High-quality TypeScript provider packages, streaming events, and tool normalization. UI/framework scope and default gateway choices should not become QUACK runtime dependencies. |
| [Ollama](https://github.com/ollama/ollama) | ADOPT | MIT | Primary optional Windows-local runtime. Native API supports discovery, streaming, tools, and structured output, but support remains model-specific and feature combinations have changed across releases. QUACK must probe and test the installed model. |
| [vLLM](https://github.com/vllm-project/vllm) | ADOPT_AS_OPTIONAL_ADAPTER | Apache-2.0 | Strong high-throughput OpenAI-compatible server, structured decoding, and configurable tool parsers. Linux/CUDA deployment and per-model parser configuration make it an optional remote/private runtime, not a Windows Core dependency. |

## Patterns adopted

- one normalized request/event/error surface;
- provider packages/adapters outside the kernel;
- explicit streaming and tool event semantics;
- hard constraints before weighted routing;
- retries, fallback, health, and circuit recovery with reason records;
- observability/evaluation as consumers of the execution boundary.

## Patterns rejected

- making any gateway mandatory;
- assuming “OpenAI-compatible” means feature-equivalent;
- importing provider catalogs as capability truth;
- silently routing private local work to a cloud gateway;
- coupling QUACK's durable mission model to a gateway's storage model.
