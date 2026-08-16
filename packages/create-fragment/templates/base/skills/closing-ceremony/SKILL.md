---
name: closing-ceremony
description: Run the full end-of-cycle closing ceremony for {{PROJECT_NAME}} in one pass — bookend, then docs-update, then release — instead of invoking the three separately. Use to wrap a release cycle. Triggers on "closing ceremony", "close out the release", "wrap the release", "ship a version".
model: sonnet
---

# {{PROJECT_NAME}} Closing Ceremony

> **ICM:** if this run was launched with a stage contract (a `*-CONTEXT.md` in `.prism/shared/plans/`, or the path in `$PRISM_ICM_CONTRACT`), read it first and honor its Inputs / Locked Decisions / Success criteria before anything else. Binding: `.prism/shared/ref/icm-run-contract.md`.

The three end-of-cycle skills, run back-to-back in order, so a release wraps in one command instead of three separate asks. Generalized from the Prism closing-ceremony workflow.

## Sequence (run in order — do not skip or reorder)

1. **Bookend** — invoke the **bookend** skill. Analyze commits since the last tag, suggest the semver bump, sync docs, and set the version. **The version is decided here.**
2. **Docs** — invoke the **docs-update** skill. Sync the docs site from the latest `docs/DOCUMENTATION-*.md`, and update the root `CHANGELOG.md` with an entry for the version (the changelog is the most-missed surface — always include it).
3. **Release** — invoke the **release** skill. Bump every version file, build + test, commit, tag, push, and create the GitHub release.

> bookend already chains docs-update + release internally; this ceremony makes the whole sequence one explicit, named entry point.

## Rules

1. **Sequential + fail-fast.** Each phase finishes clean before the next begins. If bookend or docs error, stop and report — never cut a release on a broken base.
2. **Decide the version once, in bookend**, then carry it into release — re-running a bump double-increments.
3. **Always update `CHANGELOG.md`** for the version (in docs-update) — it does not sync automatically.
4. **Honor every sub-skill's gates** (version confirm, push, GitHub release). This orchestrator adds no bypass.
5. Run `git status` first — confirm the tree is committed or intentionally staged so the release captures the intended change set.

## When to use

- Any request to do bookend + docs-update + release together as one wrap-up.
- **Not** for a docs-only or version-only job — invoke the single relevant skill.
