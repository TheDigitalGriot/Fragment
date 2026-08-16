---
name: release
description: Cut a versioned release of {{PROJECT_NAME}}. Bumps the version, builds + tests, commits, tags, pushes, and creates a GitHub release. Use for "release", "cut a release", "ship a version".
model: sonnet
---

# {{PROJECT_NAME}} Release

> **ICM:** if this run was launched with a stage contract (a `*-CONTEXT.md` in `.prism/shared/plans/`, or the path in `$PRISM_ICM_CONTRACT`), read it first and honor its Inputs / Locked Decisions / Success criteria before anything else. Binding: `.prism/shared/ref/icm-run-contract.md`.

Full release pipeline: bump version → build + test → commit → tag → push → GitHub release. Generalized from the Prism release workflow — adapt the artifact steps to whichever surfaces this project ships.

## Step 1: Determine the bump

Ask which semver component to bump (patch / minor / major). Show the current version first:

```bash
node -p "require('./package.json').version"
```

## Step 2: Bump the version

Update the version in root `package.json` and every surface that carries one (`apps/*/package.json`, `apps/mobile/app.config.js` reads a root `VERSION` if present). Keep it single-sourced — never hand-edit a version the build reads before bumping.

## Step 3: Validate + build

```bash
npm run build && npm test
```

All TS surfaces must build clean. Mobile native artifacts (`eas build`) are a separate signed step and are not part of the git release.

## Step 4: Commit + tag

```bash
git add -A && git commit -m "v<NEW_VERSION>" && git tag v<NEW_VERSION>
```

## Step 5: Push + GitHub release

```bash
git push && git push origin v<NEW_VERSION>
gh release create v<NEW_VERSION> --title "<NEW_VERSION>" --generate-notes
```

Upload build artifacts in small chunks (2–3 at a time) — GitHub's upload API 404s on bulk large uploads.

## Rules

1. Never hand-edit the version before the bump step — let one source of truth move.
2. `gh` must be authenticated (`gh auth login`). If push fails, report — never force-push.
3. Stop at the gate: confirm the bump before tagging.
4. Review `git status` before staging — never race a release against concurrent working-tree changes.
