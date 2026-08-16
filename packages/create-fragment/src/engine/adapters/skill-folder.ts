/**
 * Shared emitter for the Claude/ChatGPT "skills/<name>/" folder shape.
 *
 * ChatGPT Skills use the SAME folder layout as Claude (SKILL.md + references/ + scripts/), so ~90%
 * of the two adapters is this one function. The only divergence is the extra agents/openai.yaml
 * sidecar ChatGPT adds, which lives in chatgpt-skills.ts.
 */
import type { SkillIR } from './ir.js';
import { writeUnder } from './types.js';

/** Serialize the SKILL.md frontmatter + instructions body from the IR. */
export function renderSkillMarkdown(ir: SkillIR): string {
  const fm: string[] = ['---', `name: ${ir.name}`, `description: ${ir.description}`];
  if (ir.model) fm.push(`model: ${ir.model}`);
  fm.push('---', '');
  return fm.join('\n') + '\n' + ir.instructions.trim() + '\n';
}

/**
 * Emit `skills/<name>/SKILL.md` plus every knowledge file (references/, scripts/) under the same
 * skill root. Returns the outDir-relative paths written.
 */
export function emitSkillFolder(ir: SkillIR, outDir: string): string[] {
  const root = `skills/${ir.name}`;
  const written: string[] = [];
  written.push(writeUnder(outDir, `${root}/SKILL.md`, renderSkillMarkdown(ir)));
  for (const kf of ir.knowledgeFiles) {
    written.push(writeUnder(outDir, `${root}/${kf.path}`, kf.content));
  }
  return written;
}
