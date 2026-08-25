/**
 * Shared emitter for the Claude/ChatGPT "skills/<name>/" folder shape.
 *
 * ChatGPT Skills use the SAME folder layout as Claude (SKILL.md + references/ + scripts/), so ~90%
 * of the two adapters is this one function. The only divergence is the extra agents/openai.yaml
 * sidecar ChatGPT adds, which lives in chatgpt-skills.ts.
 */
import type { SkillIR } from './ir.js';
import { writeUnder } from './types.js';

/** Options controlling how a skill folder is serialized. */
export interface SkillFolderOptions {
  /**
   * Inject the Cowork cloud / device resource-resolution block when the skill bundles files.
   * Claude / Cowork target ONLY — the block references PLUGIN_ROOT and the Windows-MCP / claude.exe
   * device bridge, which are meaningless on other platforms (e.g. ChatGPT Skills), so those adapters
   * leave this off. See cl-plugin-structure "Cloud / device resource resolution" (standard v0.7.5+).
   */
  platformResolution?: boolean;
}

/** Marker that keeps block injection idempotent (never duplicated on re-emit). */
const RESOLUTION_MARKER = 'Resources — cloud / device resolution';

/**
 * The plugin-variant resolution block. Fragment scaffolds projects that ship AS Claude plugins, so
 * bundled docs resolve via PLUGIN_ROOT (present in the cloud) while bundled scripts always run
 * device-side (Cowork has no Bash tool).
 */
const RESOLUTION_BLOCK = [
  '## Resources — cloud / device resolution',
  '',
  'This skill bundles files under `references/` / `scripts/`. Resolve them by how the plugin is running:',
  '',
  '- **Read a bundled doc** — `PLUGIN_ROOT/<path>`. The plugin ships its whole folder, so bundled docs are present on desktop/CLI *and* in Cowork cloud.',
  '- **Run a bundled script** — always device-side. Cowork has no Bash tool, so a bundled script never executes in-cloud; run it via the device bridge (Windows-MCP PowerShell) or `claude.exe -p` headless. On desktop/CLI it runs locally.',
  '',
  'Never assume a relative `scripts/…` path executes in the cloud. If the device bridge is unavailable, say so and fall back to the inline instructions — don\'t silently fail.',
].join('\n');

/** Serialize the SKILL.md frontmatter + instructions body from the IR. */
export function renderSkillMarkdown(ir: SkillIR, opts: SkillFolderOptions = {}): string {
  const fm: string[] = ['---', `name: ${ir.name}`, `description: ${ir.description}`];
  if (ir.model) fm.push(`model: ${ir.model}`);
  fm.push('---', '');

  let body = ir.instructions.trim();
  // A skill that ships knowledge files must teach how to reach them across Cowork cloud vs
  // desktop/CLI. Inject once (idempotent) and only for the Claude/Cowork target.
  if (opts.platformResolution && ir.knowledgeFiles.length > 0 && !body.includes(RESOLUTION_MARKER)) {
    body = `${RESOLUTION_BLOCK}\n\n${body}`;
  }
  return fm.join('\n') + '\n' + body + '\n';
}

/**
 * Emit `skills/<name>/SKILL.md` plus every knowledge file (references/, scripts/) under the same
 * skill root. Returns the outDir-relative paths written.
 */
export function emitSkillFolder(ir: SkillIR, outDir: string, opts: SkillFolderOptions = {}): string[] {
  const root = `skills/${ir.name}`;
  const written: string[] = [];
  written.push(writeUnder(outDir, `${root}/SKILL.md`, renderSkillMarkdown(ir, opts)));
  for (const kf of ir.knowledgeFiles) {
    written.push(writeUnder(outDir, `${root}/${kf.path}`, kf.content));
  }
  return written;
}
