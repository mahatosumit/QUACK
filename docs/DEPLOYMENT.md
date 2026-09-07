# QUACK Deployment Guide

**Version:** 1.0.0

## Prerequisites

- Node.js 20+ (runtime)
- npm 9+ (package manager)
- Docker (optional, for containerized deployment)
- Git (for source checkout)

## Quick Start

```bash
git clone https://github.com/mahatosumit/QUACK.git
cd QUACK
npm install
npm run build
npx quack start "bootstrap the coding agent"
```

## Modes

### CLI Mode

```bash
npx quack start "analyze the workspace" --workspace ./my-project
npx quack start "refactor the main module"
```

### Server Mode

```bash
npx quack serve
# Listening on http://localhost:3157
```

### Docker Mode

```bash
docker compose up -d
# Builds and starts QUACK in container
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| QUACK_OPENAI_API_KEY | — | OpenAI API key for cloud provider |
| NVIDIA_API_KEY | — | NVIDIA NIM API key for cloud provider (never log or persist it) |
| QUACK_NVIDIA_BASE_URL | https://integrate.api.nvidia.com/v1 | NVIDIA NIM OpenAI-compatible base URL |
| QUACK_NVIDIA_MODEL | meta/llama-3.1-70b-instruct | Default NVIDIA NIM model |
| QUACK_DATA_DIR | ./.quack | Data persistence directory |
| QUACK_WORKSPACE_ROOT | cwd | Default workspace root |

## Production Deployment

1. Build: `npm run build`
2. Configure: Set environment variables
3. Start: `npx quack serve --port 3157 --headless`
4. Monitor: `curl http://localhost:3157/api/health`

## Platform Support

| Platform | Status |
|----------|--------|
| Windows 10/11 | ✅ Supported |
| Ubuntu LTS | ✅ Supported |
| Debian | ✅ Supported |
| Fedora | ✅ Supported |
| macOS | ✅ Supported |
| WSL | ✅ Supported |
| Docker | ✅ Supported |
