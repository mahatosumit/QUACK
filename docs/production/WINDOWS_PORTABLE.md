# Windows Portable Package

## Build

From PowerShell with Node.js 20 or newer:

```powershell
npm.cmd run package:windows
```

Each run creates a new isolated output directory and preserves all previous artifacts:

- `release/run-<id>/quack-os-windows-portable/`
- `release/run-<id>/quack-os-windows-portable.zip`
- `release/run-<id>/quack-os-windows-portable.zip.sha256`

The staging bundle contains compiled JavaScript and locked production
dependencies, using an explicit file allowlist. Runtime state, local assistant
configuration, and compiled tests are excluded. It does not contain development dependencies. The artifact is
currently unsigned and must not be presented as a trusted production release.

## Install and update

Extract the ZIP, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

The default target is `%LOCALAPPDATA%\Programs\QUACK OS`. Installation is staged
beside the target. An existing installation is moved to a rollback directory,
the staged copy is activated, and the rollback copy is removed only after
activation succeeds. Run the same installer to update.

Launch `QUACK OS.bat`, then open the printed loopback Control Room URL. Node.js
20+ is a prerequisite; this is a portable application bundle, not a self-contained
native executable.

## Uninstall

Run `uninstall.ps1` from the installed directory. It refuses deletion unless
`.quack-install.json` is present, then schedules removal of that exact directory.
User data outside the install directory is not removed.

## Local smoke evidence

The 2026-08-15 audit verified clean install, authenticated health and dashboard,
in-place update with no leftover rollback directory, restart, and marker-guarded
uninstall in an isolated repository-local target. Code signing, SmartScreen, and
clean-VM validation remain blocked.
