---
name: docs-update
description: Sync {{PROJECT_NAME}}'s documentation site from a versioned monolithic doc file (docs/DOCUMENTATION-[version].md). Use when the docs source changes and the site pages must be updated.
model: sonnet
---

# {{PROJECT_NAME}} Docs Update

> **ICM:** if this run was launched with a stage contract (a `*-CONTEXT.md` in `.prism/shared/plans/`, or the path in `$PRISM_ICM_CONTRACT`), read it first and honor its Inputs / Locked Decisions / Success criteria before anything else. Binding: `.prism/shared/ref/icm-run-contract.md`.

Sync a documentation site from a monolithic source doc. Generalized from the Prism docs-update workflow.

## Step 0: Find the source

```bash
ls -t docs/DOCUMENTATION-*.md 2>/dev/null | head -1
```

## Step 1: Analyze

Grep the source doc's headings (`^## |^### `); compare each section against the current site pages; identify new / changed / removed content.

## Step 2: Report + approve

Present a change summary (new sections, updated sections, pages to touch). **Wait for approval before writing.**

## Step 3: Apply

- `Edit` for targeted changes; `Write` only for new pages or >80% rewrites.
- Preserve frontmatter; add new pages to the site nav/config.

## Step 4: Update the root CHANGELOG (required — most-missed surface)

The docs site is not the only changelog surface. **Prepend** a Keep-a-Changelog entry for the version to the root `CHANGELOG.md` (`## [version] - YYYY-MM-DD` with `### Added` / `### Changed` / `### Fixed`), mined from `git log <last-tag>..HEAD`. It is not synced automatically and is the surface most often forgotten. Prepend only — never rewrite prior entries.

## Rules

1. Always summarize + get approval before writing.
2. Preserve frontmatter; never reformat or rewrap ASCII-art code blocks.
3. Track progress with a todo list for updates spanning 5+ pages.
4. ALWAYS update the root `CHANGELOG.md` for the version (Step 4) — it does not sync automatically.
