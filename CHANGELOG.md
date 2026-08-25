# Changelog

All notable changes to create-fragment (fragment-ai-scaffold) are documented here.

## v4.7.0 — 2026-08-24

### Added
- **Cloud / device resource resolution in emitted skills.** The Claude adapter now injects a plugin-variant `Resources — cloud / device resolution` block into any scaffolded skill that bundles `references/` / `scripts/` (has knowledge files). Bundled docs resolve via `PLUGIN_ROOT/<path>` (present in Cowork cloud); bundled scripts always run device-side because Cowork has no Bash tool. Injection is idempotent and Claude-target only — the ChatGPT Skills adapter is untouched, since the block references Cowork/PLUGIN_ROOT/the Windows-MCP · `claude.exe -p` device bridge. Conforms to the cl-plugin-structure standard v0.7.5+ (Prism v4.12.0). New unit tests cover injection, the no-knowledge-files and ChatGPT-target negatives, and idempotency.

## v4.6.0 — 2026-08-17

### Added
- **Multi-target adapter compiler** — emit deploy-ready output for five model surfaces from one skill IR: Claude skill folder, ChatGPT Skills (SKILL.md + agents/openai.yaml), ChatGPT Apps (hosted MCP + submission manifest), Custom-GPT, and Gemini Gems (paste-ready guidance). New src/engine/adapters/* (ir, types, claude, chatgpt-skills, chatgpt-apps, custom-gpt, gemini-gems, skill-folder, index) and an emit command.
- **ICM-infuse** — scaffolded projects now ship the ICM run-contract, stage-CONTEXT template, .gitnexus config, and ICM pointers across the meta-skills; MCP server templates (python + ts) expose `icm_prism_run`.

### Changed
- MCP server template surface retains stdio no-orphan hygiene while adding the ICM run hook.
