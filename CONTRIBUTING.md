# Contributing to QUACK

Thank you for your interest in contributing to QUACK! This document provides guidelines and instructions for contributing.

## Code of Conduct

This project follows our [Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

## How to Contribute

### 1. Reporting Bugs

- Search [existing issues](https://github.com/mahatosumit/QUACK/issues) first
- Use the [Bug Report template](https://github.com/mahatosumit/QUACK/issues/new?template=bug-report.md)
- Include: steps to reproduce, expected vs actual behavior, environment details
- Include relevant logs or error output

### 2. Suggesting Features

- Use the [Feature Request template](https://github.com/mahatosumit/QUACK/issues/new?template=feature-request.md)
- Describe the problem and proposed solution
- Explain the use case and benefits

### 3. Submitting Code Changes

#### Development Setup

```bash
git clone https://github.com/mahatosumit/QUACK.git
cd QUACK
npm install
npm run build
```

#### Making Changes

1. Create a branch: `git checkout -b feature/your-feature-name`
2. Make your changes following project conventions
3. Write or update tests as needed
4. Run the test suite: `npm test`
5. Ensure no `@ts-ignore` comments added
6. Ensure no TODOs left in production code
7. Update documentation if applicable

#### Committing

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new experiment type
fix: resolve memory leak in event bus
docs: update API reference for model router
test: add coverage for skill evolution engine
chore: update dependencies
```

#### Pull Requests

1. Push your branch and open a pull request
2. Use the [Pull Request template](https://github.com/mahatosumit/QUACK/blob/master/.github/PULL_REQUEST_TEMPLATE.md)
3. Link related issues
4. Ensure CI passes (all checks green)
5. Request review from maintainers
6. Address review feedback

### 4. Documentation

- Documentation lives in `docs/` as Markdown files
- Architecture decisions go in `docs/adr/` as numbered ADRs
- Fix typos, improve clarity, add missing details
- Verify links work

### 5. Tests

- All code changes must include or update tests
- Tests use Node.js built-in test runner (`node:test` and `node:assert`)
- Test files are `*.test.ts` co-located with source
- Run tests: `npm test`
- Require the current test suite to pass with no failures.

## Project Standards

### Code Style

- TypeScript with strict mode
- No `@ts-ignore` or `@ts-expect-error`
- No console.log in production code
- No TODO comments in production code
- ESM modules (`import`/`export`)
- Factory pattern for creating subsystems (`create*()`)

### Architecture

- Each subsystem is a module in `src/<module>/`
- Subsystems communicate via EventBus, not direct calls
- Security permissions checked at every boundary
- All significant decisions documented as ADRs

### Testing

- Tests are co-located with source (`module.test.ts`)
- Use `node:test` (describe/it pattern) and `node:assert`
- Test both success and failure paths
- Integration tests verify subsystem interaction

## Governance

See [GOVERNANCE.md](./GOVERNANCE.md) for project governance details.

## Getting Help

- Check [documentation](./docs/)
- Ask in [GitHub Discussions](https://github.com/mahatosumit/QUACK/discussions)
- Search or open [GitHub Issues](https://github.com/mahatosumit/QUACK/issues)

## Recognition

Contributors are acknowledged in:
- Release notes
- Maintainer recognition for sustained contributions
- GitHub's contributor graph
