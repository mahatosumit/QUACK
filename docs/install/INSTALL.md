# Installing QUACK OS

QUACK ships as the npm package `@quack/os`. The `quack` CLI is a thin layer
over the canonical runtime — `quack command → QuackRuntime →
CapabilityBroker → governed execution`. No repository clone or build step
is required.

## Requirements

| Requirement | Minimum | Why |
| :--- | :--- | :--- |
| Node.js | 22.5 | `node:sqlite` (storage + multi-process coordination) |
| npm | bundled with Node.js | package installation |
| OS | Windows, Linux, macOS | x64 and arm64 |

Installers never silently install a runtime. If Node.js is missing or too
old, the installer stops and tells you how to fix it.

## Option 1 — npm (all platforms)

> Available once the first release is published to npm. Until then, install
> from a checkout or a built tarball: `npm install -g path/to/quack-os-1.0.0.tgz`.

```bash
npm install -g @quack/os
```

Then:

```bash
quack --version
quack init
quack doctor
```

## Option 2 — official installer

> **Status:** the installer scripts are maintained in this repository
> (`installers/`) and exercised by CI (fail-closed checks + drift guards), but
> the `quack.os` website serving them is not yet live. Once the site is
> deployed, the commands below work as written. Until then use Option 1 —
> the installers perform exactly the same npm installation.

Linux / macOS:

```bash
curl -fsSL https://quack.os/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://quack.os/install.ps1 | iex
```

The installer:

1. Detects OS and architecture (x64 / arm64), refusing unsupported ones.
2. Verifies Node.js >= 22.5 and npm — fails closed, no silent runtime install.
3. Installs exactly one package: `@quack/os`.
4. Verifies `quack` is on PATH.
5. Runs `quack doctor` as a health check.
6. Prints next steps (`quack init`).

If `quack` is not on PATH after install, the installer prints the exact npm
global bin directory to add.

## Option 3 — offline tarball

Download the release tarball + `SHA256SUMS.txt` from GitHub Releases,
verify the checksum, then:

```bash
npm install -g ./quack-os-<version>.tgz
```

Always verify the checksum before installing a downloaded tarball:

```bash
sha256sum -c SHA256SUMS.txt        # Linux/macOS
Get-FileHash quack-os-<version>.tgz -Algorithm SHA256   # Windows
```

## First run

```bash
quack init
```

Creates the QUACK home (default `~/.quack`, override with `QUACK_HOME`):

```
.quack/
├── config/    # config.json — runtime settings
├── data/      # quack.sqlite, coordination.sqlite (missions, recovery)
├── logs/
├── skills/    # skill roots scanned by discovery
├── cache/
├── models/
└── runtime/
```

Secrets are never stored in the QUACK home or config file. Provider
credentials stay in the environment of the launching process.

## Updating

```bash
quack update    # checks registry for a newer version
npm install -g @quack/os@latest
```

Updates never touch `~/.quack` user data. Rollback to any prior version with
`npm install -g @quack/os@<version>`.

## Uninstalling

```bash
npm uninstall -g @quack/os
quack uninstall --purge-data   # also removes ~/.quack (run before uninstalling)
```

`quack uninstall --purge-data` refuses to delete a custom `QUACK_HOME`
automatically — remove custom locations manually.

## Troubleshooting

- `quack` not found → add the npm global bin to PATH (`npm prefix -g`).
- `doctor` reports Node too old → install Node.js >= 22.5 LTS.
- Database errors → run `quack doctor`; restore a verified backup with
  `quack restore <path>` or select a healthy data directory.

See [Troubleshooting](../TROUBLESHOOTING.md) and [Security](security/INSTALL_SECURITY.md).
