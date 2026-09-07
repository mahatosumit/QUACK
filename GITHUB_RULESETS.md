# GitHub Rulesets Recommendations for QUACK

This document provides recommended branch protection rules and repository settings for QUACK administrators.

## Default Branch Protection (`master`)

These rules protect the default branch from accidental or unauthorized changes.

### Recommended Rules

| Rule | Setting | Rationale |
|------|---------|-----------|
| Require pull request before merging | ✅ Enabled | All changes must go through PR review |
| Required approvals | **1** | At least one reviewer must approve |
| Dismiss stale reviews | ✅ | Outdated reviews are cleared when new commits are pushed |
| Require review from Code Owners | ✅ | Core files require maintainer approval |
| Require status checks | ✅ | CI must pass before merging |
| Required status checks | `build-and-test` (all matrix), `lint`, `security-scan` | All CI checks must pass |
| Require branches up to date | ✅ | Branch must be rebased on latest master |
| Require conversation resolution | ✅ | All comments must be resolved |
| Require signed commits | Optional | Enable if commit signing is desired |
| Restrict force pushes | ✅ | Block all force pushes unless explicitly needed |
| Restrict deletions | ✅ | Prevent accidental branch deletion |
| Block direct pushes | ✅ | Only approved maintainers can push directly |
| Linear history | ✅ | Require squash merging or rebase for clean history |

### Merge Strategies

| Strategy | Recommended | Notes |
|----------|-------------|-------|
| Merge commits | ✅ | Preserves commit history |
| Squash merging | ✅ | For feature branches |
| Rebase merging | ✅ | For linear history preference |

*Allow at least "Squash merging" and "Rebase merging" for flexibility.*

## Tag Protection

| Rule | Setting |
|------|---------|
| Restrict tag creation | ✅ Only maintainers and admins |
| Require signed tags | Optional |

## Pull Request Settings

| Setting | Value |
|---------|-------|
| Allow auto-merge | ✅ |
| Auto-merge method | Squash |
| Always suggest updating PR branches | ✅ |
| Allow edits from maintainers | ✅ |

## Issue Settings

| Setting | Value |
|---------|-------|
| Issues | ✅ Enabled |
| Preserve issue/PR templates | ✅ |
| Links to contact | ✅ Community docs |

## Actions Settings

| Setting | Value |
|---------|-------|
| Actions | ✅ Enabled |
| Allow all actions | ✅ |
| Allow actions created by GitHub | ✅ |
| Allow marketplace actions | ✅ |
| Allow approved actions only | Tracked via CODEOWNERS review |

## Implementation Notes

1. These rulesets are configured through **GitHub Settings > Code and automation > Rules > Rulesets**
2. The `gh` CLI can also be used: `gh api repos/:owner/:repo/branches/master/protection`
3. Organization-level rulesets offer additional options (required for deployment protection rules on free plans)
4. Repository rulesets are available on all GitHub plans including free

## Security Note

Force pushes should be restricted to emergency security fixes only, and even then should be performed with `--force-with-lease` rather than `--force`. Document the `git` safety procedures in [SECURITY.md](./SECURITY.md).
