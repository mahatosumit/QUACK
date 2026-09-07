import { type ProviderAdapter, type ProviderCapabilityProfile, type ProviderChatRequest, type ProviderChatResponse, type ProviderStreamChunk } from "@quack/os";

export class CustomProvider implements ProviderAdapter {
  readonly id = "custom-provider";

  async getModels(): Promise<ProviderCapabilityProfile[]> {
    return [
      {
        providerId: this.id,
        modelId: "custom-model-1",
        costPer1kInputTokens: 0.01,
        costPer1kOutputTokens: 0.02,
        contextWindow: 128000,
        supportsTools: true,
        supportsStreaming: true,
        supportsStructuredOutput: true,
        reasoningScore: 85,
        latencyP50Ms: 200,
        latencyP99Ms: 500,
        isLocal: false
      }
    ];
  }

  async chat(request: ProviderChatRequest): Promise<ProviderChatResponse> {
    // Implement your vendor API call here
    return {
      message: { role: "assistant", content: "Hello from Custom Provider!" },
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 }
    };
  }

  async *stream(request: ProviderChatRequest): AsyncIterableIterator<ProviderStreamChunk> {
    // Implement your streaming vendor API call here
    yield { type: "content", text: "Hello " };
    yield { type: "content", text: "from Custom Provider!" };
  }
}
