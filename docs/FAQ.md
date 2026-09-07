# QUACK FAQ

## General

**Q: What is QUACK?**
A: QUACK (Quantum Unified Autonomous Cognitive Kernel) is an experimental, provider-independent AI runtime.

**Q: Who is QUACK for?**
A: Developers building AI-powered applications, researchers working with multiple AI providers, and teams needing a unified AI execution platform.

**Q: Is QUACK production-ready?**
A: No production certification is established. The native harness is detected but uncertified, several execution capabilities are unsupported, and passing local tests do not establish deployment readiness. See the [readiness report](production/PRODUCTION_READINESS_REPORT.md).

## Architecture

**Q: How does QUACK route AI requests?**
A: Through the Intelligence Router, which scores models across 7 dimensions (capability, latency, cost, reliability, hardware, preferences, historical data).

**Q: Can I use OpenAI with QUACK?**
A: Yes. QUACK supports OpenAI-compatible providers through the provider registry.

**Q: Can I use local models?**
A: Yes. QUACK supports local runtimes (Ollama, llama.cpp) through the Runtime Registry.

## Development

**Q: How do I create a plugin?**
A: See the Plugin Guide and example plugins in the marketplace.

**Q: How do I create a skill?**
A: Skills are defined with a manifest and execute function. See the Skill Guide.

**Q: How do I contribute?**
A: See CONTRIBUTING.md for development workflow, coding standards, and PR process.

## Support

**Q: What platforms are supported?**
A: Windows 10/11, Ubuntu LTS, Debian, Fedora, macOS, WSL, and Docker.

**Q: Where do I report bugs?**
A: GitHub Issues at https://github.com/mahatosumit/QUACK/issues

**Q: How do I get help?**
A: Open a GitHub issue, check the Troubleshooting Guide, or review the Architecture Book.
