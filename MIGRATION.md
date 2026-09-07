# Migration Guide

## Migrating to QUACK v1.0

### From v1.0.0-rc.1 to v1.0.0 (Production Final)

1. **System Health Verification**: Before upgrading your workflows, run `quack doctor` to assert that your environment is fully compliant with the production release requirements (Node.js >= 20, correct memory paths).
2. **Persistence Upgrade**: `memory.json` has been updated to use atomic batched flushing. This is backward-compatible with existing JSON file states, meaning your memory data carries over automatically.
3. **Benchmarking Access**: You can now profile your custom environments using the `quack benchmark` and `quack stress` automated commands to guarantee performance baseline adherence on your hardware.

### From v0.x to v1.0.0-rc.1

QUACK v1.0 is a major release that completes the core architecture and introduces production-ready features.

### Breaking Changes

1. **AI Runtime Manager**: All AI execution now routes through the AIRM. If you were calling providers directly, switch to using `system.airm.routeRequest()`.
2. **Capability-based routing**: Instead of selecting specific models by name, specify required capabilities (reasoning, coding, vision, speech, etc.).
3. **Desktop API restructured**: API endpoints now organized under `/api/airm/*`, `/api/platform/*`, `/api/cos/*`, `/api/computer/*`.

### New Configuration

Add to your environment:
```env
QUACK_DATA_DIR=./.quack
QUACK_WORKSPACE_ROOT=./workspace
QUACK_OPENAI_API_KEY=sk-...  # Optional
```

### What Changed

| Area | v0.x | v1.0 |
|------|------|------|
| Version | 0.1.0 | 1.0.0-rc.1 |
| Runtime | Single runtime | 3 default runtimes (Ollama, llama.cpp, OpenAI) |
| Model selection | Name-based | Capability-based via 27-dimension scoring |
| AI execution | Direct provider calls | AIRM Intelligence Router |
| GPU management | None | GpuScheduler with VRAM tracking |
| Model caching | None | LRU/LFU/FIFO/TTL PromptCache + ModelCache |
| Pipelines | None | Composable multi-step AI pipelines |
| Benchmarks | None | 13 benchmark types with scoring |
| Desktop GUI | Static HTML mock | Live-connected API dashboard |
| Tests | ~300 | 711 passing |
| Documentation | 0 ADRs | 22 ADRs covering all decisions |

### Rollback

To roll back to v0.x:
1. Revert to the previous package.json version.
2. Replace `createAIRM()` calls with direct provider calls.
3. Remove AIRM-related desktop API route registrations.

### Need Help?

Open an issue on the repository or refer to the Architecture Decision Records in `docs/adr/`.
