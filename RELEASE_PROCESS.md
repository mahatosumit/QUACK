# QUACK Release Process

A release requires an explicit maintainer decision. Local build artifacts are
candidates, not production certification or authorization to publish.

## Preparation

1. Establish the actual Git root, revision, tracked files, and release history.
   A source snapshot without Git metadata cannot pass this gate.
2. Align VERSION, package versions, and release notes. Run the current type,
   static-quality, runtime, contract, and SDK checks with no relevant failures.
3. Run `node scripts/check-public-docs.mjs` and
   `node --test scripts/public-release.test.mjs`.
4. Review public attribution, private reporting contacts, dependency advisories,
   and complete Git-history secret scanning. Resolve private conduct reporting
   before opening public participation.
5. Review the explicit files in `packaging/public-files.json`. New documentation
   is included in portable releases only after adding its path to this manifest.
   Keep runtime state, private memory, assistant configuration, and test outputs
   outside public staging. Preserve private local data.

## Packaging

The tag-triggered GitHub Release workflow and local Windows packaging use the
same staging implementation, `scripts/public-release.mjs`. Each invocation
creates a new `release/run-<id>/` directory and preserves older artifacts.

For a Windows portable candidate, run `npm run package:windows`. The package
contains the compiled runtime, approved documentation, Windows launch/install
scripts, and locked production dependencies. Compiled tests are excluded.
Verify the generated ZIP and checksum and complete install, update, restart,
and uninstall tests in an isolated target. See
[Windows Portable Package](docs/production/WINDOWS_PORTABLE.md).

The GitHub workflow creates a draft release for tagged revisions. Inspect the
candidate and current readiness evidence before publishing it. The unused
semantic-release configuration has been removed; there is one release workflow.

Packages remain private until a separate npm publication decision and clean
consumer-install checks. Docker images, signed native installers, and npm
publication are not outputs of this release workflow.

## Post-release

Record the exact artifact hashes, tested revision, supported platforms, known
limitations, and migration guidance. Update
[SUPPORTED_VERSIONS.md](SUPPORTED_VERSIONS.md) and the changelog.
