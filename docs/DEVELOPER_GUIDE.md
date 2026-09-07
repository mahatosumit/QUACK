# Developer Guide

Welcome to the QUACK OS Development Guide!

## Setup
1. Clone the repository.
2. Run `npm install`.
3. Run `npm run build` to compile TypeScript.
4. Run `npm test` to execute the full test suite.

## Project Layout
- `src/`: Core source code.
- `docs/`: Documentation and architecture ADRs.
- `gui/`: Optional web interface components.

## Adding Features
All new features should be implemented as **Plugins**, **Skills**, or **Tools**. Avoid modifying the Kernel or Core Engine unless fixing bugs.

1. **Skills**: Add a markdown file to `src/skills/` describing the workflow.
2. **Tools**: Create a class implementing `QuackTool` in `src/tools/` and register it in `ToolRegistry`.
3. **Providers**: Implement `QuackProviderV1`, register it in `CanonicalProviderRegistry`, and run the provider conformance suite. Legacy `ProviderAdapter` implementations migrate through `LegacyProviderV1Bridge`.

## Linting & Typechecking
Always run `npm run lint` and `npm run test:contracts` before submitting PRs. We maintain a strict `noImplicitAny` and `strictNullChecks` policy.

## Documentation
Update the relevant SDK markdown files in `docs/` when modifying public APIs.
