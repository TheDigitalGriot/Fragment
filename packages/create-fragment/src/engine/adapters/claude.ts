/**
 * Claude adapter — Fragment's native home format.
 *
 * Emits `skills/<name>/SKILL.md` + references/ + scripts/. This is the reference lowering: the IR
 * fields map one-to-one onto Claude's skill folder, so the emitter is just the shared skill-folder
 * writer with no target-specific sidecar.
 */
import type { SkillIR } from './ir.js';
import type { Adapter, EmitOptions } from './types.js';
import { emitSkillFolder } from './skill-folder.js';

export const claudeAdapter: Adapter = {
  id: 'claude',
  label: 'Claude (native skill folder)',
  installable: true,
  emit(ir: SkillIR, outDir: string, _opts?: EmitOptions): string[] {
    return emitSkillFolder(ir, outDir);
  },
};
