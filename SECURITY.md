# QUACK Security Policy

QUACK is under active development and is not production-certified. Historical
security reports describe the source and environment tested at their stated date;
they do not certify a later checkout or release.

## Reporting a vulnerability

Do not file public issues containing exploit details, credentials, or personal data.
Use the project's [private security advisory channel](https://github.com/mahatosumit/QUACK/security/advisories/new).
Maintainers must verify that private reporting is enabled and monitored before a
public release. No separate security email address is currently published.

Include the affected revision, a minimal reproduction, impact, and a proposed fix
if available. Reporters should never include live credentials. Response times are
maintainer targets, not a guaranteed service-level agreement.

## Supported versions

See [SUPPORTED_VERSIONS.md](./SUPPORTED_VERSIONS.md). Support status does not imply
that a version has completed production or third-party security certification.

## Implemented controls and limits

- Runtime permission checks and capability grants are implemented in
  `src/security/permissions.ts` and `src/security/capability-broker.ts`.
  Coverage depends on the execution path. A grant or manifest does not sandbox
  arbitrary JavaScript, subprocesses, or third-party plugin code.
- Approval handling is implemented in `src/security/approval-controller.ts`.
  Operator approvals must match the requested operation and scope.
- Network policy checks are implemented in `src/security/network-policy.ts`.
  Separate provider, MCP, browser, and plugin paths require their own enforcement;
  do not assume every network request passes through one policy boundary.
- `PluginSandbox` validates declared permissions. It is not process, VM, or OS
  isolation. In-process plugins are trusted code with the privileges of the host.
- `JsonlAuditLog` serializes events to disk. It has no cryptographic integrity
  protection or general payload redaction. Audit logs and runtime databases may
  contain private prompts, tool arguments, results, paths, and model responses.
- Provider keys should be supplied through the documented environment variables.
  Do not store credentials in source, example files, prompts, or tracked settings.
  No blanket guarantee is made that arbitrary extension errors are secret-free.
- Local server defaults, authentication, path checks, and command restrictions must
  be verified for the selected entry point. Do not expose a development server to
  an untrusted network or assume localhost alone authenticates every client.

QUACK uses third-party runtime and development dependencies. Review lockfile
changes and dependency advisories. CI includes code and secret scanning, but a
passing scan is not proof that the repository contains no vulnerabilities or
secrets.

## Runtime data and public artifacts

Treat `.quack/`, local assistant settings, audit logs, checkpoints, memory, and
learning histories as private operational data. They are ignored and excluded
from the explicit release manifest. Ignore rules do not remove previously tracked
files or historical commits.

Public artifacts are assembled from `packaging/public-files.json` and compiled
runtime files using `scripts/public-release.mjs`. Packaging rejects local state,
credential file paths, symlinks, and compiled tests. It does not inspect every
possible secret encoding or certify the contents of third-party packages.

Before release, verify the actual Git index and history, examine the staged
artifact, and complete the current runtime security and conformance gates. A
source archive without Git metadata cannot establish a clean secret history.

## Incident handling

Confirm the affected revisions and artifacts. Revoke or rotate any exposed live
credentials, restrict affected services, preserve private forensic evidence, and
coordinate remediation and disclosure through the private reporting channel.
