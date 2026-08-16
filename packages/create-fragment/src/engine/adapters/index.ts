/**
 * Adapter registry — the Fragment multi-target compiler's dispatch table.
 *
 * Maps a target id to its adapter and exposes a single `emitTarget()` entry point used by both the
 * CLI (`create-fragment emit --target <id>`) and programmatic callers/tests. One IR in, one target
 * package out.
 */
import type { Adapter, EmitOptions } from './types.js';
import type { SkillIR } from './ir.js';
import { claudeAdapter } from './claude.js';
import { chatgptSkillsAdapter } from './chatgpt-skills.js';
import { chatgptAppsAdapter } from './chatgpt-apps.js';
import { customGptAdapter } from './custom-gpt.js';
import { geminiGemsAdapter } from './gemini-gems.js';

export const ADAPTERS: Record<string, Adapter> = {
  [claudeAdapter.id]: claudeAdapter,
  [chatgptSkillsAdapter.id]: chatgptSkillsAdapter,
  [chatgptAppsAdapter.id]: chatgptAppsAdapter,
  [customGptAdapter.id]: customGptAdapter,
  [geminiGemsAdapter.id]: geminiGemsAdapter,
};

export const TARGET_IDS = Object.keys(ADAPTERS);

export function getAdapter(id: string): Adapter {
  const adapter = ADAPTERS[id];
  if (!adapter) {
    throw new Error(`Unknown target "${id}". Valid targets: ${TARGET_IDS.join(', ')}`);
  }
  return adapter;
}

/** Lower one IR to one target package under outDir. Returns the outDir-relative paths written. */
export function emitTarget(targetId: string, ir: SkillIR, outDir: string, opts?: EmitOptions): string[] {
  return getAdapter(targetId).emit(ir, outDir, opts);
}

export type { Adapter, EmitOptions } from './types.js';
export type { SkillIR, NormalizedTool, KnowledgeFile } from './ir.js';
export { buildIRFromSkill, loadIR } from './ir.js';
