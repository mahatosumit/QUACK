# @quack/sdk — QUACK TypeScript SDK

The official TypeScript SDK for building on the QUACK AI Operating System.

## Build from this checkout

Run these commands from the repository root:

```bash
npm install
npm run build
npm run build --workspace @quack/sdk
```

## Quick Start

```typescript
import { QuackClient } from "@quack/sdk";

const client = new QuackClient();
await client.initialize({ workspaceRoot: "./my-project" });
await client.submitGoal("summarize the workspace documents");
await client.shutdown();
```

## API

See the [QUACK API reference](https://github.com/mahatosumit/QUACK/blob/master/docs/API_REFERENCE.md) for the current API and runtime integration notes. The packages are currently private; registry publication is a separate release decision.

## Requirements

- Node.js 20+
- TypeScript 5+
