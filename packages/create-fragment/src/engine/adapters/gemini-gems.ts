/**
 * Gemini Gems adapter (GUIDANCE ONLY — never an installable artifact).
 *
 * Gemini Gems have NO manifest and NO official install/create API. The only honest, durable output
 * is paste-ready guidance a human enters into the Gem builder, plus a manual file-attach checklist.
 * We deliberately DO NOT emit a fake "installable" Gem or a reverse-engineered client — doing so
 * would be a lie that breaks the moment Google changes the private surface.
 */
import type { SkillIR } from './ir.js';
import type { Adapter, EmitOptions } from './types.js';
import { writeUnder } from './types.js';

// Gemini Gems knowledge cap at the time of writing: 10 files x 100MB each.
const MAX_FILES = 10;
const MAX_FILE_MB = 100;

function renderGuidance(ir: SkillIR): string {
  const toolLines =
    ir.tools.length > 0
      ? ir.tools.map((t) => `- \`${t.name}\` — ${t.description}`).join('\n')
      : '- (This skill declares no external tools; it operates on the attached knowledge + the prompt.)';

  return `# Gemini Gem guidance — ${ir.name}

> Guidance only. Gemini Gems have no manifest or install API, so there is **no installable artifact**
> to generate. Paste the four sections below into the Gem builder's instructions field, then attach
> the knowledge files listed in \`knowledge-attach-checklist.md\`.

## Persona
You are ${ir.name}, an assistant whose primary job is: ${ir.primaryCapability}.

## Task
${ir.description}

## Context
The following capabilities are available conceptually (Gemini cannot call MCP tools directly — treat
these as the operations the assistant reasons about and, where a connector exists, drives):

${toolLines}

Reference the attached knowledge files for domain detail before answering.

## Format
- Be direct and concrete; lead with the answer.
- When a step maps to one of the capabilities above, name it explicitly.
- Cite the attached knowledge file a claim comes from.

---

## Full instructions (source of truth — paste under "Instructions" if the builder allows long form)

${ir.instructions.trim()}
`;
}

function renderChecklist(ir: SkillIR): string {
  const files = ir.knowledgeFiles.slice(0, MAX_FILES);
  const rows =
    files.length > 0
      ? files.map((k, i) => `- [ ] ${i + 1}. \`${k.path}\` (${k.role})`).join('\n')
      : '- [ ] (No knowledge files derived from this skill — attach any supporting docs manually.)';

  const overflow =
    ir.knowledgeFiles.length > MAX_FILES
      ? `\n> NOTE: ${ir.knowledgeFiles.length} files exceed the Gem cap of ${MAX_FILES}; ` +
        `only the first ${MAX_FILES} are listed. Consolidate or prioritize before attaching.\n`
      : '';

  return `# Knowledge attach checklist — ${ir.name}

Gemini Gems support up to **${MAX_FILES} files × ${MAX_FILE_MB}MB** each, attached manually in the
builder. Attach the following:

${rows}
${overflow}`;
}

export const geminiGemsAdapter: Adapter = {
  id: 'gemini-gems',
  label: 'Gemini Gems (guidance only)',
  installable: false,
  emit(ir: SkillIR, outDir: string, _opts?: EmitOptions): string[] {
    return [
      writeUnder(outDir, 'gem-guidance.md', renderGuidance(ir)),
      writeUnder(outDir, 'knowledge-attach-checklist.md', renderChecklist(ir)),
    ];
  },
};
