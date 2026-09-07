# QUACK OS Community Guide

Welcome to the QUACK OS Community! We are dedicated to building the most stable, reliable, and extensible AI Operating System.

## Where to get help

- **GitHub Discussions**: The primary place to ask questions, share workflows, and discuss AI OS design.
- **GitHub Issues**: Reserved strictly for bug reports and verified feature requests.
- **Documentation**: Always check the `docs/` directory before asking a question.

## How to Contribute

We value stability and extensibility over rapid feature bloat.

1. **Read the Architecture Constitution**: `ARCHITECTURE_CONSTITUTION.md` is the law. We do not accept speculative architecture changes to the core runtime.
2. **Build Plugins and Skills**: The best way to add features to QUACK OS is via the `PluginSandbox` or the `SkillRegistry`. 
3. **Use the Templates**: We provide official templates for plugins, providers, and workflows in the `templates/` directory.

## Submitting Pull Requests

1. **Test First**: Ensure `npm test` and `npm run typecheck` pass.
2. **Benchmark**: If you are optimizing the core, you must provide benchmarks demonstrating the improvement.
3. **Documentation**: Update the `CAPABILITY_REGISTRY.json` and SDK markdown files if you are adding new API surface.

## Code of Conduct
All community members are expected to follow our `CODE_OF_CONDUCT.md`. We prioritize a respectful, evidence-based engineering culture.
