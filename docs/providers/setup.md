# Provider Setup and Validation

How to configure, validate, and troubleshoot QUACK model providers.

## Supported providers

| Provider | Credential env var | Notes |
|---|---|---|
| NVIDIA NIM | `NVIDIA_API_KEY` | Remote GPU inference |
| OpenAI-compatible | `QUACK_OPENAI_API_KEY` | Any OpenAI-API-shaped endpoint |
| vLLM | `QUACK_VLLM_BASE_URL` + `QUACK_VLLM_MODEL` (+ `QUACK_VLLM_API_KEY`) | Remote private serving |
| Ollama (local) | `QUACK_OLLAMA_BASE_URL` (+ `QUACK_OLLAMA_MODEL`) | Local inference; LM Studio works via the OpenAI-compatible provider |
| Anthropic | `ANTHROPIC_API_KEY` | Claude models |

## Commands

```bash
quack provider list          # registered providers + credential presence (never values)
quack provider doctor        # live health check of every provider
quack provider test <id>     # health-check one provider
```

All three support `--json`.

**Deep health check note:** there is deliberately no `quack doctor --deep`. The
semantic deep-provider check already exists as `quack provider doctor` (live
API health + credential presence + persisted history). `quack doctor` /
`quack doctor --json` covers the system surface (runtime, storage, recovery
coordination, security, skills, providers). Keeping the two commands separate
avoids a duplicate health-check system.

## Security contract

- Secrets are read **only** through `SecretProvider` (`src/security/secret-provider.ts`). No layer outside it reads provider credential env vars.
- Secret *names* are allowlisted per consumer; a provider can only ask for its own declared credential.
- Value resolution requires `secrets.read:<name>` authority through the CapabilityBroker — denial fails closed.
- `quack provider` commands only ever see **presence** (is it set?), never values. All output text passes `redactSecrets`, which strips `KEY=…`-style leaks, bearer tokens, and bare `sk-…`/`ghp_…`/`AKIA…`/`nvapi-…` literals.
- Authentication failures fail closed: an invalid or missing key yields an unhealthy report and exit code 1, never a silent fallback.

## Health records

Every `provider doctor` / `provider test` appends a record to `<dataDir>/providers/health.json`:

- provider id, timestamp, healthy, redacted message, source (`live`/`restored`)
- capped history (20/provider), atomic writes
- records never contain credentials, auth headers, or response bodies

## Local providers (LM Studio / Ollama)

Ollama auto-registers when `QUACK_OLLAMA_BASE_URL` (or `QUACK_OLLAMA_MODEL`) is set — default `http://127.0.0.1:11434/v1`.

LM Studio exposes an OpenAI-compatible endpoint; configure it via the OpenAI-compatible provider env vars pointing at its local server (typically `http://127.0.0.1:1234/v1`).

## Validation tests

`src/providers/validation.test.ts` covers: missing key, invalid key (fails closed through the provider's own healthCheck), successful mock provider, throwing healthCheck (fails closed, redacted), and secret-leak prevention. `src/security/phase7-security.test.ts` additionally verifies raw keys never survive redaction.

## Troubleshooting

| Symptom | Meaning |
|---|---|
| `missing credentials: NVIDIA_API_KEY` | Env var not set in the launching process |
| `unhealthy` with redacted message | Provider reachable but rejected the credential — invalid key fails closed |
| Provider absent from `provider list` | Registration env vars (e.g. `QUACK_VLLM_BASE_URL`+`QUACK_VLLM_MODEL`) not set |
