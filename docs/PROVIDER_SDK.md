# Provider SDK Documentation

> vNext: `QuackProviderV1` in `src/contracts/v1` is the canonical provider
> boundary. The legacy APIs documented below remain available through
> `LegacyProviderV1Bridge`; new providers should follow
> `docs/EXECUTION_CONTRACTS_V1.md` and run `npm run test:contracts`.

Providers in QUACK OS normalize APIs for local and cloud LLMs.

## `AiCapability` Matching
Unlike other systems that hardcode strings like `"gpt-4"`, QUACK uses capability matching. 
A provider must declare its capabilities in `ProviderCapabilityProfile`:

```typescript
export interface ProviderCapabilityProfile {
  readonly providerId: string;
  readonly modelId: string;
  readonly costPer1kInputTokens: number;
  readonly costPer1kOutputTokens: number;
  readonly contextWindow: number;
  readonly supportsTools: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsStructuredOutput: boolean;
  readonly isLocal: boolean;
}
```

## Creating a Provider
Implement `ProviderAdapter`:

```typescript
export interface ProviderAdapter {
  readonly id: string;
  getModels(): Promise<ProviderCapabilityProfile[]>;
  chat(request: ProviderChatRequest): Promise<ProviderChatResponse>;
  stream(request: ProviderChatRequest): AsyncIterableIterator<ProviderStreamChunk>;
}
```

Then register it:
```typescript
runtime.getProviderRegistry().register(new MyCustomProvider());
```
