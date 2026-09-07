import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createQuackSystem } from "../distributions/swe-system.js";

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(vars)) {
    previous.set(key, process.env[key]);
    const value = vars[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function makeSystem(): ReturnType<typeof createQuackSystem> {
  return createQuackSystem({
    workspaceRoot: process.cwd(),
    dataDir: join(tmpdir(), `quack-provider-test-${randomUUID()}`),
  });
}

test("providers - NVIDIA registers only from NVIDIA_API_KEY", () => {
  withEnv(
    {
      NVIDIA_API_KEY: undefined,
      QUACK_NVIDIA_API_KEY: "legacy-key-must-not-be-read",
      QUACK_OPENAI_API_KEY: undefined,
    },
    () => {
      const system = makeSystem();
      assert.deepEqual(system.providers.list(), ["core.echo-provider"]);
    },
  );

  withEnv(
    {
      NVIDIA_API_KEY: "test-credential",
      QUACK_NVIDIA_API_KEY: undefined,
      QUACK_NVIDIA_MODEL: "z-ai/glm-5.2",
      QUACK_OPENAI_API_KEY: undefined,
    },
    () => {
      const system = makeSystem();
      assert.ok(system.providers.list().includes("provider.nvidia-nim"));
      assert.ok(system.providerKernel.list().some((provider) =>
        provider.metadata().providerId === "provider.nvidia-nim" &&
        provider.metadata().credentialEnvironmentVariables.includes("NVIDIA_API_KEY"),
      ));
    },
  );
});

test("providers - OpenAI-compatible and NVIDIA providers can coexist", () => {
  withEnv(
    {
      QUACK_OPENAI_API_KEY: "openai-test-key",
      QUACK_OPENAI_MODEL: "gpt-test",
      NVIDIA_API_KEY: "test-credential",
      QUACK_NVIDIA_API_KEY: undefined,
      QUACK_NVIDIA_MODEL: "z-ai/glm-5.2",
    },
    () => {
      const ids = makeSystem().providers.list();
      assert.ok(ids.includes("provider.openai-compatible"));
      assert.ok(ids.includes("provider.nvidia-nim"));
    },
  );
});
