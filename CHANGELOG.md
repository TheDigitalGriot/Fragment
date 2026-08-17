# Changelog

All notable changes to create-fragment (fragment-ai-scaffold) are documented here.

## v4.6.0 — 2026-08-17

### Added
- **Multi-target adapter compiler** — emit deploy-ready output for five model surfaces from one skill IR: Claude skill folder, ChatGPT Skills (SKILL.md + agents/openai.yaml), ChatGPT Apps (hosted MCP + submission manifest), Custom-GPT, and Gemini Gems (paste-ready guidance). New src/engine/adapters/* (ir, types, claude, chatgpt-skills, chatgpt-apps, custom-gpt, gemini-gems, skill-folder, index) and an emit command.
- **ICM-infuse** — scaffolded projects now ship the ICM run-contract, stage-CONTEXT template, .gitnexus config, and ICM pointers across the meta-skills; MCP server templates (python + ts) expose `icm_prism_run`.

### Changed
- MCP server template surface retains stdio no-orphan hygiene while adding the ICM run hook.
