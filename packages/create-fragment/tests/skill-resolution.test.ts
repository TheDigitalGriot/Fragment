import { describe, it, expect } from 'vitest';
import { renderSkillMarkdown } from '../src/engine/adapters/skill-folder.js';
import { claudeAdapter } from '../src/engine/adapters/claude.js';
import { chatgptSkillsAdapter } from '../src/engine/adapters/chatgpt-skills.js';
import type { SkillIR } from '../src/engine/adapters/ir.js';
import { mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const MARKER = 'Resources — cloud / device resolution';

function ir(overrides: Partial<SkillIR> = {}): SkillIR {
  return {
    name: 'demo',
    description: 'A demo skill.',
    instructions: '# Demo\n\nDo the thing.',
    knowledgeFiles: [],
    primaryCapability: 'demo',
    tools: [],
    ...overrides,
  };
}

const withKnowledge = (): SkillIR =>
  ir({ knowledgeFiles: [{ path: 'references/api.md', role: 'reference', content: '# api' }] });

describe('cloud/device resolution block emission', () => {
  it('injects the plugin-variant block for a Claude skill that bundles files', () => {
    const md = renderSkillMarkdown(withKnowledge(), { platformResolution: true });
    expect(md).toContain(MARKER);
    expect(md).toContain('PLUGIN_ROOT/<path>');
    expect(md).toContain('Cowork has no Bash tool');
  });

  it('does NOT inject when the skill bundles no files', () => {
    const md = renderSkillMarkdown(ir(), { platformResolution: true });
    expect(md).not.toContain(MARKER);
  });

  it('does NOT inject when platformResolution is off (e.g. ChatGPT target)', () => {
    const md = renderSkillMarkdown(withKnowledge(), { platformResolution: false });
    expect(md).not.toContain(MARKER);
  });

  it('is idempotent — never duplicates an already-present block', () => {
    const already = ir({
      knowledgeFiles: [{ path: 'references/api.md', role: 'reference', content: '# api' }],
      instructions: `## ${MARKER}\n\n(already here)\n\n# Body`,
    });
    const md = renderSkillMarkdown(already, { platformResolution: true });
    expect(md.split(MARKER).length - 1).toBe(1);
  });

  it('claude adapter injects the block; chatgpt adapter does not', () => {
    const claudeDir = mkdtempSync(join(tmpdir(), 'frag-claude-'));
    claudeAdapter.emit(withKnowledge(), claudeDir);
    const claudeMd = readFileSync(join(claudeDir, 'skills', 'demo', 'SKILL.md'), 'utf-8');
    expect(claudeMd).toContain(MARKER);

    const gptDir = mkdtempSync(join(tmpdir(), 'frag-gpt-'));
    chatgptSkillsAdapter.emit(withKnowledge(), gptDir);
    const gptMd = readFileSync(join(gptDir, 'skills', 'demo', 'SKILL.md'), 'utf-8');
    expect(gptMd).not.toContain(MARKER);
  });
});
