# Path Security

Status: SUPPORTED (implemented + adversarially tested on Windows
runtime; Linux/macOS pending CI).

ADR: [0040](../adr/0040-cross-platform-platform-abstraction.md)
Source: `src/platform/paths.ts` (`resolveInsideRoot`)

## Denials (before resolution)

| Denial | Covers |
| --- | --- |
| `NOT_A_STRING` / `CONTAINS_NUL` | non-strings, NUL bytes |
| `DEVICE_PATH` | `\\.\`, `\\?\` (and `/`-spelled variants) — Windows device namespaces |
| `UNC_PATH` | `\\server\share` (and `//`-spelled) — network paths |
| `ALTERNATE_DATA_STREAM` | any colon beyond a leading drive letter (`file.txt:stream`) |
| `NOT_ABSOLUTE_ROOT` | caller passed a relative root |
| `TRAVERSAL_ESCAPE` | lexical `..` escape of the root |
| `SYMLINK_ESCAPE` | symlink/junction resolving outside the root |
| `RESOLVED_OUTSIDE_ROOT` | post-resolution containment failure |

## Containment semantics

- Lexical resolution must stay inside the (realpath'd) root.
- If the target exists, its realpath must stay inside the realpath'd
  root — BOTH sides realpath'd so Windows 8.3 short-path vs long-path
  spellings of the same directory compare equal.
- New-file targets: every existing ancestor up to (not past) the root is
  checked — a symlinked parent pointing outside is rejected before
  creation.
- The ancestor walk stops at the root so the root's own parents are not
  flagged.

## Attack families verified (platform suite + adversarial cross-suite)

`../` chains (incl. 40-deep and mixed-separator), encoded traversal
(`%2e%2e%2f`, `..%2F` — never URL-decoded into an escape; worst case a
literal in-root filename), absolute paths, drive-letter case (`c:`
vs `C:`), mixed separators (`..\..\..`), UNC, device paths (incl.
`\\.\PhysicalDrive0`), ADS, NUL bytes, symlink escape of existing
targets, junction escape, new-file parent escape, `sub\..\..\escape`
chains.

## Enforcement points

Every path entering the runtime, tools (`resolveInsideWorkspace`),
skill discovery (manifest containment), quarantine writes, and the
isolation IO boundary passes this policy (or the workspace layer built
on it). Git-status working directories are contained; discovery
manifests are contained; quarantine paths are contained before write.
