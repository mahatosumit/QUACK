# Installer Security

The QUACK installers (`installers/install.sh`, `installers/install.ps1`)
follow these non-negotiable rules:

## Rules

1. **Fail closed.** Any unmet requirement (OS, architecture, Node.js version,
   npm presence) aborts the install. No "best effort" installs.
2. **One package.** The installer installs exactly `@quack/os` plus its
   declared npm dependencies. It never installs runtimes, drivers, or other
   software silently.
3. **No silent user-data changes.** The installer never writes inside
   `~/.quack` beyond the health check, which may create empty database
   files in `~/.quack/data/` (correct default location) when `quack doctor`
   probes storage and recovery. First-run initialization happens via
   `quack init`, run by the user.
4. **Print every action before taking it.** Platform, architecture, runtime
   version, install command, health check — all visible.
5. **Checksum verification for offline artifacts.** Release tarballs ship
   with `SHA256SUMS.txt`; verify before `npm install -g ./file.tgz`.

## Piping scripts from the web

`curl ... | bash` runs remote text in your shell. The official installer is
designed to be served from `quack.os` (static GitHub Pages of this
repository's `website/` directory, same commit as the published package).
> **Deployment status:** the site is not live yet; until it is, install via
> npm (see [INSTALL.md](../INSTALL.md)). If you prefer not to pipe when the
> site is available:

```bash
# Download, inspect, then run
curl -fsSL https://quack.os/install.sh -o install.sh
less install.sh
bash install.sh
```

## What the installer never does

- Execute downloaded scripts beyond the one you invoked
- Expose or persist secrets (provider keys stay in your environment)
- Modify files outside the npm global prefix
- Bypass permissions or require elevation

## npm supply-chain posture

- Locked dependencies (`npm ci` in CI; `package-lock.json` committed)
- Scoped package `@quack/os` with public, auditable provenance
- `engines.node >= 22.5` enforced (`.npmrc` sets `engine-strict=true`), so
  npm refuses installs on unsupported Node versions

## Report an issue

See [SECURITY.md](../../../SECURITY.md) for responsible disclosure.
