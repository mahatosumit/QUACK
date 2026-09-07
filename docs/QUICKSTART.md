# QUACK Control Room Quickstart

## Prerequisites

- Node.js 20 or later
- A local checkout of QUACK

## Start locally

```bash
npm install
npm run build
node start.js serve --port 3000
```

Open `http://localhost:3000/dashboard`.

The default runtime includes the offline echo provider, so Control Room can be explored
without an API key. Configure an OpenAI-compatible, NVIDIA NIM, Ollama, or vLLM
provider through the documented server environment variables when you intentionally
want live provider access. Never put a provider key in the browser.

## First mission

1. Open **New mission** from the Control Room.
2. Enter a concise goal and select **Dry run** to validate the request without
   executing it, or submit a normal mission to use the configured runtime.
3. Open **Missions** to inspect its trace, evidence, verification, and events.
4. Review pending decisions in **Approvals**. A confirmation
   records only a human decision; it cannot mutate source code.

For endpoint details, see [API Server](API_SERVER.md). For Studio safety and screen
details, see [QUACK Studio](QUACK_STUDIO_UI.md). For the unsigned Windows bundle,
see [Windows Portable Package](production/WINDOWS_PORTABLE.md).
