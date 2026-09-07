# Deprecation & API Evolution Policy

With the release of QUACK OS v1.0.0, the core kernel and SDK interfaces are **frozen**. We guarantee backward compatibility for the entire `1.x.x` lifecycle.

## SemVer Promises
- **MAJOR (2.0.0)**: Incompatible API changes to the Kernel, Provider Adapter, or Workflow engine.
- **MINOR (1.1.0)**: New backward-compatible capabilities (e.g., adding Vector DB support to `KnowledgeGraphStore`).
- **PATCH (1.0.1)**: Backward-compatible bug fixes and security patches.

## How we deprecate
If an API must be replaced (e.g., a better tool format is standardized):
1. The old interface is marked with the `@deprecated` JSDoc tag.
2. A console warning is emitted at runtime ONCE per session.
3. The old interface is maintained for at least two MINOR releases before removal in the next MAJOR release.
4. The migration path is documented in `MIGRATION.md`.

*No core architecture changes will be accepted without a formal RFC and approval from the Architecture Review Board.*
