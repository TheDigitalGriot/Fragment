---
name: bookend
description: Context-aware version bump + release for {{PROJECT_NAME}}. Analyzes commits since the last tag, suggests a semver increment, then chains docs-update + release. Use to finalize and ship a version.
model: sonnet
---

# {{PROJECT_NAME}} Bookend

> **ICM:** if this run was launched with a stage contract (a `*-CONTEXT.md` in `.prism/shared/plans/`, or the path in `$PRISM_ICM_CONTRACT`), read it first and honor its Inputs / Locked Decisions / Success criteria before anything else. Binding: `.prism/shared/ref/icm-run-contract.md`.

Finalize a release cycle: analyze commits → suggest version → sync docs → release. Generalized from the Prism bookend workflow.

## Step 1: Analyze changes

```bash
LAST=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
git log ${LAST:+$LAST..}HEAD --oneline | grep -E "feat|fix|BREAKING"
```

## Step 2: Suggest the bump

Map commit types to a semver increment, then confirm with the user (or take an override `X.Y.Z`):

- `feat:` → **minor** · `fix:` → **patch** · `BREAKING CHANGE:` → **major**
- 3+ features, no breaking → **minor**; mixed fixes + features → **minor** (features win)

## Step 3: Sync docs

Invoke the **docs-update** skill to sync the docs site from the latest `docs/DOCUMENTATION-*.md`.

## Step 4: Release

Invoke the **release** skill with the confirmed version.

## Rules

1. Always suggest before bumping; validate semver (`X.Y.Z`).
2. Stop at each gate (version, docs, release) for confirmation.
3. Preserve prior docs snapshots for rollback.
