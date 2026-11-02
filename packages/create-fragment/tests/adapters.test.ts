import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { chatgptSkillsAdapter, renderOpenAiYaml } from '../src/engine/adapters/chatgpt-skills.js';
import { ADAPTERS, TARGET_IDS } from '../src/engine/adapters/index.js';
import { buildIRFromSkill, type SkillIR } from '../src/engine/adapters/ir.js';

const EM_DASH = '—';

function ir(overrides: Partial<SkillIR> = {}): SkillIR {
  return {
    name: 'demo',
    description: 'A demo skill. It does a thing.',
    instructions: '# Demo\n\nDo the thing.',
    knowledgeFiles: [{ path: 'references/api.md', role: 'reference', content: '# api' }],
    primaryCapability: 'A demo skill',
    tools: [],
    ...overrides,
  };
}

const withTools = (): SkillIR =>
  ir({
    tools: [
      { name: 'run_command', description: 'Run a command', inputSchema: {} },
      { name: 'list_files', description: 'List files', inputSchema: {} },
    ],
  });

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

describe('chatgpt-skills agents/openai.yaml (schema: learn.chatgpt.com/docs/build-skills)', () => {
  it('emits the sidecar inside the skill folder, as a sibling of SKILL.md', () => {
    const out = mkdtempSync(join(tmpdir(), 'frag-gpt-'));
    const written = chatgptSkillsAdapter.emit(ir(), out);
    expect(written).toContain('skills/demo/agents/openai.yaml');
    expect(existsSync(join(out, 'skills', 'demo', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(out, 'skills', 'demo', 'agents', 'openai.yaml'))).toBe(true);
    expect(existsSync(join(out, 'agents', 'openai.yaml'))).toBe(false);
  });

  it('uses only the doc top-level sections: interface, policy, dependencies', () => {
    const yaml = renderOpenAiYaml(withTools(), { mcpUrl: 'https://x.test/mcp', appTitle: 'Demo' });
    const topKeys = yaml
      .split('\n')
      .filter((l) => /^\S/.test(l))
      .map((l) => l.split(':')[0]);
    expect(topKeys).toEqual(['interface', 'policy', 'dependencies']);
    // name/description are SKILL.md frontmatter, not openai.yaml fields; mcp_servers is the old shape.
    expect(yaml).not.toMatch(/^name:/m);
    expect(yaml).not.toMatch(/^description:/m);
    expect(yaml).not.toContain('mcp_servers');
  });

  it('maps IR onto interface fields', () => {
    const yaml = renderOpenAiYaml(ir(), { appTitle: 'Demo App' });
    expect(yaml).toContain('  display_name: Demo App');
    expect(yaml).toContain('  short_description: A demo skill');
  });

  it('policy.allow_implicit_invocation follows the doc default (true) when the IR is silent', () => {
    expect(renderOpenAiYaml(ir())).toContain('policy:\n  allow_implicit_invocation: true');
  });

  it('policy.allow_implicit_invocation is driven by the IR, never hardcoded', () => {
    expect(renderOpenAiYaml(ir({ allowImplicitInvocation: false }))).toContain(
      '  allow_implicit_invocation: false',
    );
    expect(renderOpenAiYaml(ir({ allowImplicitInvocation: true }))).toContain(
      '  allow_implicit_invocation: true',
    );
  });

  it('derives allowImplicitInvocation from disable-model-invocation frontmatter', () => {
    const dir = mkdtempSync(join(tmpdir(), 'frag-src-'));
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: s\ndescription: d\ndisable-model-invocation: true\n---\nbody\n');
    expect(buildIRFromSkill(dir).allowImplicitInvocation).toBe(false);
    const dir2 = mkdtempSync(join(tmpdir(), 'frag-src-'));
    writeFileSync(join(dir2, 'SKILL.md'), '---\nname: s\ndescription: d\n---\nbody\n');
    expect(buildIRFromSkill(dir2).allowImplicitInvocation).toBeUndefined();
  });

  it('declares MCP tool dependencies in the doc shape', () => {
    const yaml = renderOpenAiYaml(withTools(), { mcpUrl: 'https://x.test/mcp' });
    expect(yaml).toContain(
      [
        'dependencies:',
        '  tools:',
        '    - type: "mcp"',
        '      value: demo',
        '      description: "MCP server for demo (tools: run_command, list_files)"',
        '      transport: "streamable_http"',
        '      url: "https://x.test/mcp"',
      ].join('\n'),
    );
  });

  it('omits dependencies when the skill declares no tools (the section is optional)', () => {
    expect(renderOpenAiYaml(ir())).not.toContain('dependencies');
  });
});

describe('no em dash (U+2014) in emitted text', () => {
  // Every adapter, every file it writes. Source IR is dash-free, so any U+2014 found came from a
  // Fragment template string, which is exactly what this gate exists to catch.
  for (const id of TARGET_IDS) {
    it(`${id}: emitted files contain no U+2014`, () => {
      const out = mkdtempSync(join(tmpdir(), `frag-${id}-`));
      ADAPTERS[id].emit(withTools(), out, { mcpUrl: 'https://x.test/mcp' });
      for (const f of walk(out)) {
        const text = readFileSync(f, 'utf-8');
        expect(text.includes(EM_DASH), `${f} contains U+2014`).toBe(false);
      }
    });
  }

  it('gemini-gems paste-in files (gem-guidance.md, knowledge-attach-checklist.md) are dash-free', () => {
    const out = mkdtempSync(join(tmpdir(), 'frag-gem-'));
    ADAPTERS['gemini-gems'].emit(withTools(), out);
    for (const f of ['gem-guidance.md', 'knowledge-attach-checklist.md']) {
      expect(readFileSync(join(out, f), 'utf-8')).not.toContain(EM_DASH);
    }
  });

  it('claude resolution block stays idempotent against the legacy em-dash heading', () => {
    const legacy = ir({ instructions: `## Resources ${EM_DASH} cloud / device resolution\n\n(old)\n\n# Body` });
    const out = mkdtempSync(join(tmpdir(), 'frag-claude-'));
    ADAPTERS['claude'].emit(legacy, out);
    const md = readFileSync(join(out, 'skills', 'demo', 'SKILL.md'), 'utf-8');
    expect(md).not.toContain('Resources: cloud / device resolution');
  });
});
