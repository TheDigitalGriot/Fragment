import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, sep } from 'path';
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

describe('gemini-skills upload folder (Gemini app: Customize > Skills > Create > Upload)', () => {
  const mixed = (): SkillIR =>
    ir({
      knowledgeFiles: [
        { path: 'references/api.md', role: 'reference', content: '# api' },
        { path: 'references/notes.txt', role: 'reference', content: 'notes' },
        { path: 'references/data.csv', role: 'reference', content: 'a,b\n1,2' },
        { path: 'scripts/run.py', role: 'script', content: 'print(1)' },
        { path: 'references/config.yaml', role: 'reference', content: 'k: v' },
        { path: 'references/schema.json', role: 'reference', content: '{}' },
        { path: 'scripts/tool.mjs', role: 'script', content: 'export {}' },
        { path: 'scripts/tool.ts', role: 'script', content: 'export {}' },
      ],
    });

  it('copies only accepted types (md, txt, py, csv) and puts SKILL.md at the top of the upload folder', () => {
    const out = mkdtempSync(join(tmpdir(), 'frag-gsk-'));
    ADAPTERS['gemini-skills'].emit(mixed(), out);
    const folder = join(out, 'skills', 'demo');
    expect(existsSync(join(folder, 'SKILL.md'))).toBe(true);
    const files = walk(folder).map((f) => f.slice(folder.length + 1).split(sep).join('/')).sort();
    expect(files).toEqual(
      ['SKILL.md', 'references/api.md', 'references/data.csv', 'references/notes.txt', 'scripts/run.py'].sort(),
    );
  });

  it('writes upload-manifest.json as a SIBLING of skills/, never inside the upload folder, listing the skips', () => {
    const out = mkdtempSync(join(tmpdir(), 'frag-gsk-'));
    ADAPTERS['gemini-skills'].emit(mixed(), out);
    expect(existsSync(join(out, 'upload-manifest.json'))).toBe(true);
    expect(walk(join(out, 'skills')).some((f) => f.endsWith('upload-manifest.json'))).toBe(false);
    const m = JSON.parse(readFileSync(join(out, 'upload-manifest.json'), 'utf-8'));
    expect(m.uploadFolder).toBe('skills/demo');
    expect(m.skipped.map((s: { path: string }) => s.path).sort()).toEqual(
      ['references/config.yaml', 'references/schema.json', 'scripts/tool.mjs', 'scripts/tool.ts'].sort(),
    );
  });

  it('fails loudly when the name is not kebab-case', () => {
    const out = mkdtempSync(join(tmpdir(), 'frag-gsk-'));
    for (const bad of ['Demo', 'demo_skill', 'demo--x', '-demo', 'demo skill']) {
      expect(() => ADAPTERS['gemini-skills'].emit(ir({ name: bad }), out)).toThrow(/kebab-case/);
    }
  });

  it('fails loudly when the frontmatter name differs from its source folder name', () => {
    const out = mkdtempSync(join(tmpdir(), 'frag-gsk-'));
    expect(() =>
      ADAPTERS['gemini-skills'].emit(ir({ name: 'demo' }), out, { sourceDir: join(tmpdir(), 'other-name') }),
    ).toThrow(/does not match its folder name/);
    expect(() =>
      ADAPTERS['gemini-skills'].emit(ir({ name: 'demo' }), out, { sourceDir: join(tmpdir(), 'demo') }),
    ).not.toThrow();
  });

  it('drops the Claude/Cowork-only Resources section up to the next ## heading, keeping the rest', () => {
    const body = [
      '# Demo',
      '',
      '## Resources - cloud / device resolution',
      '',
      'Read via PLUGIN_ROOT. Run device-side.',
      '',
      '## 1. Do the thing',
      '',
      'Step one.',
    ].join('\n');
    const out = mkdtempSync(join(tmpdir(), 'frag-gsk-'));
    ADAPTERS['gemini-skills'].emit(ir({ instructions: body }), out);
    const md = readFileSync(join(out, 'skills', 'demo', 'SKILL.md'), 'utf-8');
    expect(md).not.toContain('Resources - cloud / device resolution');
    expect(md).not.toContain('PLUGIN_ROOT');
    expect(md).toContain('## 1. Do the thing');
    expect(md).toContain('Step one.');
    const m = JSON.parse(readFileSync(join(out, 'upload-manifest.json'), 'utf-8'));
    expect(m.droppedSections).toHaveLength(1);
  });

  it('emits no em dash (U+2014) anywhere, including the manifest', () => {
    const out = mkdtempSync(join(tmpdir(), 'frag-gsk-'));
    ADAPTERS['gemini-skills'].emit(mixed(), out);
    for (const f of walk(out)) expect(readFileSync(f, 'utf-8')).not.toContain(EM_DASH);
  });

  it('copies PDFs and images byte-for-byte (base64 through the IR, never decoded as text)', () => {
    const src = mkdtempSync(join(tmpdir(), 'frag-gsk-src-'));
    const skillDir = join(src, 'demo');
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0xc3, 0x28]);
    mkdirSync(join(skillDir, 'references'), { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: demo\ndescription: d\n---\n# Demo\n', 'utf-8');
    writeFileSync(join(skillDir, 'references', 'logo.png'), bytes);
    const built = buildIRFromSkill(skillDir);
    expect(built.knowledgeFiles[0].encoding).toBe('base64');
    const out = mkdtempSync(join(tmpdir(), 'frag-gsk-'));
    ADAPTERS['gemini-skills'].emit(built, out, { sourceDir: skillDir });
    expect(readFileSync(join(out, 'skills', 'demo', 'references', 'logo.png')).equals(bytes)).toBe(true);
  });
});

describe('gemini-skills "How the other surfaces run this" (Amendment A1, D9)', () => {
  const surfacesMd = [
    '# Image generation per surface',
    '',
    '| Surface | Generate | Edit from attached refs | Mode | Source |',
    '|---|---|---|---|---|',
    '| Gemini app, main chat (Nano Banana 2 / Pro) | yes | yes, multi-image | RUN | https://x.test/a |',
    '| Codex CLI / Codex app | yes, built in (`$imagegen`, gpt-image-2) | yes (CLI `-i` / `--image`, app drag-in) | RUN via `$imagegen` | https://x.test/b |',
    '| Claude (claude.ai, Claude Code, Cowork) | no | no | HANDOFF (sort the refs) | https://x.test/c |',
  ].join('\n');

  const withSurfaces = (instructions: string): SkillIR =>
    ir({
      instructions,
      knowledgeFiles: [
        { path: 'references/surfaces.md', role: 'reference', content: surfacesMd },
        { path: 'scripts/sort-refs.py', role: 'script', content: 'print(1)' },
      ],
    });

  const resources = [
    '# Demo',
    '',
    '## Resources - cloud / device resolution',
    '',
    'Read via PLUGIN_ROOT. Run device-side.',
    '',
    '## 1. Do the thing',
    '',
    'Step one.',
  ].join('\n');

  function emitted(src: SkillIR): string {
    const out = mkdtempSync(join(tmpdir(), 'frag-gsk-d9-'));
    ADAPTERS['gemini-skills'].emit(src, out);
    return readFileSync(join(out, 'skills', 'demo', 'SKILL.md'), 'utf-8');
  }

  it('replaces the Resources section in place: section present, Resources absent, body kept in order', () => {
    const md = emitted(withSurfaces(resources));
    expect(md).toContain('## How the other surfaces run this');
    expect(md).not.toContain('Resources - cloud / device resolution');
    expect(md).not.toContain('PLUGIN_ROOT');
    expect(md.indexOf('# Demo')).toBeLessThan(md.indexOf('## How the other surfaces run this'));
    expect(md.indexOf('## How the other surfaces run this')).toBeLessThan(md.indexOf('## 1. Do the thing'));
  });

  it('derives every surface fact from the IR and its surfaces table, under 12 lines, no em dash', () => {
    const md = emitted(withSurfaces(resources));
    const start = md.indexOf('## How the other surfaces run this');
    const section = md.slice(start, md.indexOf('## 1. Do the thing')).trim();
    expect(section.split('\n').length).toBeLessThanOrEqual(12);
    expect(section).not.toContain(EM_DASH);
    expect(section).toMatch(/Claude \(Code and Cowork\).*`scripts\/sort-refs\.py`.*device-side.*HANDOFF mode because Claude cannot generate images/);
    expect(section).toMatch(/Codex.*`agents\/openai\.yaml`.*RUN mode, generating with `\$imagegen`.*CLI `-i` \/ `--image`, app drag-in/);
    expect(section).toMatch(/Gemini app \(this build\).*RUN mode with Nano Banana 2 \/ Pro.*cannot run `scripts\/sort-refs\.py`.*as a table/);
  });

  it('is still added (after the H1) when the source has no Resources section, and falls back without a table', () => {
    const md = emitted(ir({ instructions: '# Demo\n\nBody.' }));
    expect(md).toContain('## How the other surfaces run this');
    expect(md.indexOf('# Demo')).toBeLessThan(md.indexOf('## How the other surfaces run this'));
    expect(md).toContain('Body.');
    expect(md).not.toContain('undefined');
  });
});
