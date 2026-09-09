# QUACK OS — Originality Policy

QUACK studies the ecosystem for **concepts**, never for implementation. This
document records, for each externally-inspired feature area, the chain:

```
External concept → Generalized lesson → QUACK requirement → Original implementation
```

## Prohibited — absolutely

Copying, forking, cloning, translating, or reverse-engineering into QUACK:

- source code (open or proprietary) of another product
- UI assets, icons, logos, layouts, CSS, or distinctive visual identity
- branding, names, wording style, or distinctive terminology of another product
- proprietary prompts, system prompts, prompt templates, or prompt chains
- proprietary workflows or implementation details observed in closed systems
- evaluation datasets/benchmarks under licenses that do not permit reuse

QUACK owns its architecture, terminology, interaction model, visual language,
prompts, and implementation. Where a QUACK term coincides with a common
industry word ("mission", "trace", "receipt", "approval"), that is generic
vocabulary, not borrowed identity.

## Inspiration ledger

### Visual AI workspaces (category; includes Odysseus-style GUIs)

- **External concept:** a dedicated visual environment where AI work is
  created, observed, and steered — mission/task consoles, execution
  timelines, agent views.
- **Generalized lesson:** users need to *see work as a system* (state,
  progress, decisions, evidence), not only to converse.
- **QUACK requirement:** Mission Control + Mission Detail + Agent Workspace
  inside the existing Studio SPA.
- **Original implementation:** extend `src/dashboard/web/studio.ts` (our own
  dependency-free SPA) with QUACK-native views; all state from real events.
- **Intentionally different:** no external design system, no copied layout or
  component structure, no dashboard frameworks; QUACK's own information
  architecture (missions/capabilities/evidence/receipts) drives the views.

### Conversational/streaming interfaces (category; includes Hermes-style)

- **External concept:** streamed interaction — visible thinking/progress,
  live tool activity, conversation as the primary surface.
- **Generalized lesson:** streaming is valuable only when it reflects real
  execution; a control conversation benefits from live mission state.
- **QUACK requirement:** QUACK Console (P3) with a *unified client event
  contract* — model stream chunks (when genuinely produced) + mission events.
- **Original implementation:** Console consumes the existing SSE projection
  of our EventBus; model chunks flow only through `GovernedModelRuntime`.
- **Intentionally different:** QUACK streams *missions*, not just text; no
  fabricated token streams; conversation explicitly cannot execute anything.

### Evaluation harnesses (category; includes DeepSeek-style harnesses)

- **External concept:** serious, reproducible evaluation of models and agents
  across standardized scenarios, with recorded history.
- **Generalized lesson:** an AI environment earns trust by evaluating its
  own components under its own governance.
- **QUACK requirement:** QUACK Harness (P5) — model/agent/runtime/security
  evaluation, model-vs-model over governed providers, regression history.
- **Original implementation:** extend `QuackNativeHarness` +
  `harness/evaluator.ts` + `harness/scenarios.ts`; scenarios authored
  in-repo; results into the existing sqlite evaluation history.
- **Intentionally different:** evaluations run *inside* QUACK's governance
  (broker/network/secrets apply to harness calls too); no external benchmark
  assets are copied; scenario categories are ours.

### Other categories surveyed for lessons only

- **Agent frameworks:** lesson — durability and governance beat autonomy
  theater; QUACK's answer is missions + capabilities + fail-closed.
- **MCP clients:** lesson — external tool ecosystems need trust profiles;
  QUACK's answer is the existing TRUSTED/RESTRICTED/ISOLATED profiles.
- **Workflow automation:** lesson — triggers should produce governed work;
  QUACK's automation (P8) will submit missions, never run side effects.
- **AI IDEs:** lesson — surface parity; QUACK's answer is one runtime behind
  CLI/Studio/Console/SDK.

## Review rule

Any PR introducing externally-inspired UX must add an entry to this ledger
before review. Reviewers reject: copied code/assets/branding/prompts, or
distinctive-expression similarity to any external product. Inspiration is
documented; imitation is prohibited.
