# QUACK Troubleshooting Guide

## Common Issues

### Build Fails

**Error**: `tsc -p tsconfig.json` fails
**Solution**: 
1. `npm ci` — clean install dependencies
2. Check Node.js version: `node --version` (must be 20+)
3. Clear TypeScript cache: delete `tsconfig.tsbuildinfo`

### Tests Fail

**Error**: Tests timeout or fail
**Solution**:
1. Run single test: `node --test dist/path/to/test.js`
2. Check for port conflicts on 3157
3. Ensure dist/ is up to date: `npm run build`

### Desktop Server Won't Start

**Error**: Port in use
**Solution**:
```bash
npx quack serve --port 8080  # Use different port
```

### Agent Communication Fails

**Error**: Agents not responding
**Solution**:
1. Check event bus connectivity
2. Verify agent registry has active agents
3. Check organizational memory for capacity

### AI Routing Fails

**Error**: No models match capability
**Solution**:
1. Register a runtime: AIRM runtime-registry
2. Add a model with the required capability
3. Check capability definitions

### Docker Issues

**Error**: Container exits immediately
**Solution**:
1. Build with `docker compose build --no-cache`
2. Check logs: `docker compose logs`
3. Verify volume mounts are correct

## Getting Help

- GitHub Issues: https://github.com/mahatosumit/QUACK/issues
- Architecture Book: docs/ARCHITECTURE_BOOK.md
- ADRs: docs/adr/
