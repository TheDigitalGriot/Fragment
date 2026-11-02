# Changelog

All notable changes to create-fragment (fragment-ai-scaffold) are documented here.

## Unreleased

### Fixed
- **ChatGPT Skills / Codex `agents/openai.yaml` now matches OpenAI's current schema** (https://learn.chatgpt.com/docs/build-skills, read 2026-11-01). The sidecar used to carry `name`, `description`, a hardcoded `allow_implicit_invocation: false` and `mcp_servers`, none of which the doc defines. It now emits only the doc's three sections: `interface` (`short_description` from the IR's primary capability, `display_name` when an app title is given), `policy.allow_implicit_invocation` driven by the IR (new `SkillIR.allowImplicitInvocation`, derived from Claude's `disable-model-invocation: true`; the doc default `true` when silent), and `dependencies.tools` (`type: "mcp"`, `value`, `description`, `transport: "streamable_http"`, `url`) only when the skill declares tools. The file moved from `<out>/agents/openai.yaml` to `<out>/skills/<name>/agents/openai.yaml`, a sibling of `SKILL.md` as the doc's folder layout shows, so the skill folder is now self-contained.
- **No em dashes (U+2014) in emitted text.** The Gemini Gems templates (`gem-guidance.md`, `knowledge-attach-checklist.md`), the ChatGPT Apps test-case stubs and the Claude cloud/device resolution block now use colons, commas and semicolons. The resolution heading is now `Resources: cloud / device resolution`; the old em-dash heading is still recognised so a re-emit never adds a second block. New `tests/adapters.test.ts` fails if any adapter writes U+2014 into any emitted file, and pins the openai.yaml shape.

## v4.7.0 — 2026-08-24

### Added
- **Cloud / device resource resolution in emitted skills.** The Claude adapter now injects a plugin-variant `Resources — cloud / device resolution` block into any scaffolded skill that bundles `references/` / `scripts/` (has knowledge files). Bundled docs resolve via `PLUGIN_ROOT/<path>` (present in Cowork cloud); bundled scripts always run device-side because Cowork has no Bash tool. Injection is idempotent and Claude-target only — the ChatGPT Skills adapter is untouched, since the block references Cowork/PLUGIN_ROOT/the Windows-MCP · `claude.exe -p` device bridge. Conforms to the cl-plugin-structure standard v0.7.5+ (Prism v4.12.0). New unit tests cover injection, the no-knowledge-files and ChatGPT-target negatives, and idempotency.

## v4.6.0 — 2026-08-17

### Added
- **Multi-target adapter compiler** — emit deploy-ready output for five model surfaces from one skill IR: Claude skill folder, ChatGPT Skills (SKILL.md + agents/openai.yaml), ChatGPT Apps (hosted MCP + submission manifest), Custom-GPT, and Gemini Gems (paste-ready guidance). New src/engine/adapters/* (ir, types, claude, chatgpt-skills, chatgpt-apps, custom-gpt, gemini-gems, skill-folder, index) and an emit command.
- **ICM-infuse** — scaffolded projects now ship the ICM run-contract, stage-CONTEXT template, .gitnexus config, and ICM pointers across the meta-skills; MCP server templates (python + ts) expose `icm_prism_run`.

### Changed
- MCP server template surface retains stdio no-orphan hygiene while adding the ICM run hook.
