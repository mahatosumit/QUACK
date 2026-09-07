# QUACK Versioning Policy

## Semantic Versioning

QUACK uses [Semantic Versioning 2.0.0](https://semver.org/):

```
MAJOR.MINOR.PATCH
```

- **MAJOR** increment indicates breaking changes to public APIs, data formats, or behavior
- **MINOR** increment indicates new features or improvements without breaking changes
- **PATCH** increment indicates backwards-compatible bug fixes and minor improvements

## Pre-release Versions

Pre-release versions follow the format `MAJOR.MINOR.PATCH-<tag>.<number>`:

- `1.0.0-rc.1` — Release candidate
- `1.0.0-beta.1` — Beta release
- `1.0.0-alpha.1` — Alpha release

## Version Lifecycle

1. **Development:** Work happens on `master` branch
2. **Pre-release:** Tagged as `vX.Y.Z-rc.N` for testing
3. **Stable release:** Tagged as `vX.Y.Z` on `master`
4. **Maintenance:** Critical fixes backported to release branches as needed

## Compatibility

- **Public API:** All exported functions, classes, interfaces, and types in `src/` are considered public API
- **CLI commands and flags** are stable within a major version
- **Desktop API endpoints** are stable within a major version
- **Configuration format** is stable within a major version
- **Plugin and Skill SDKs** follow their own versioning tied to QUACK releases

## Deprecation

- Deprecated features are marked in documentation and emit runtime warnings
- Deprecated features are removed in the next MAJOR version
- Removal is announced at least one minor version in advance

## Changelog

All changes are documented in [CHANGELOG.md](./CHANGELOG.md), organized by release.

## Current Version

The current version is maintained in the `VERSION` file at the repository root.
