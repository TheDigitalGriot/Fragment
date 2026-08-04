import { describe, it, expect, beforeEach } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { mkdtempSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

describe('mcp surface', () => {
  let parentDir: string;

  beforeEach(() => {
    parentDir = mkdtempSync(join(tmpdir(), 'fragment-mcp-'));
  });

  function scaffold(): string {
    const projectDir = join(parentDir, 'mcp-proj');
    runInit({
      name: 'mcp-proj',
      outputDir: projectDir,
      templatesDir: TEMPLATES_DIR,
      surfaces: ['mcp'],
      authorName: 'TestAuthor',
      skipInstall: true,
    });
    return projectDir;
  }

  it('emits both python and ts server variants', () => {
    const dir = scaffold();
    for (const f of [
      'apps/mcp/README.md',
      'apps/mcp/python/server.py',
      'apps/mcp/python/_hygiene.py',
      'apps/mcp/python/mcp_launcher.py',
      'apps/mcp/python/pyproject.toml',
      'apps/mcp/ts/src/server.ts',
      'apps/mcp/ts/src/hygiene.ts',
      'apps/mcp/ts/src/launcher.ts',
      'apps/mcp/ts/package.json',
      'apps/mcp/ts/tsconfig.json',
    ]) {
      expect(existsSync(join(dir, f)), `${f} should exist`).toBe(true);
    }
  });

  it('bakes the 5 stdio-hygiene rules into the emitted python server', () => {
    const dir = scaffold();
    const hygiene = readFileSync(join(dir, 'apps/mcp/python/_hygiene.py'), 'utf-8');
    expect(hygiene).toContain('stdin=subprocess.DEVNULL'); // rule 2
    expect(hygiene).toContain('_PROXY_VARS'); // rule 3
    expect(hygiene).toContain('interpreter-first'); // rule 4
    const launcher = readFileSync(join(dir, 'apps/mcp/python/mcp_launcher.py'), 'utf-8');
    expect(launcher).toContain('JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE'); // rule 5
  });

  it('bakes the 5 stdio-hygiene rules into the emitted ts server', () => {
    const dir = scaffold();
    const hygiene = readFileSync(join(dir, 'apps/mcp/ts/src/hygiene.ts'), 'utf-8');
    expect(hygiene).toContain("stdio: ['ignore', 'pipe', 'pipe']"); // rule 2 (DEVNULL equivalent)
    expect(hygiene).toContain('PROXY_VARS'); // rule 3
    expect(hygiene).toContain('bundled-first'); // rule 4
    const launcher = readFileSync(join(dir, 'apps/mcp/ts/src/launcher.ts'), 'utf-8');
    expect(launcher).toContain('installReaper'); // rule 5 (portable reaper)
    expect(launcher).toContain('KILL_ON_JOB_CLOSE'); // documents the native-addon caveat
  });

  it('scaffolds the bus-first channel transport in both variants (checklist B13)', () => {
    const dir = scaffold();
    // Passive-bus helpers are emitted alongside the hygiene helpers.
    for (const f of ['apps/mcp/python/channel_bus.py', 'apps/mcp/ts/src/channel-bus.ts']) {
      expect(existsSync(join(dir, f)), `${f} should exist`).toBe(true);
    }
    // Python: tools:{} floor (Server() declares tools by default) + both bus halves, no push default.
    const pyBus = readFileSync(join(dir, 'apps/mcp/python/channel_bus.py'), 'utf-8');
    expect(pyBus).toContain('$STATE_DIR/events'); // IN half documented
    expect(pyBus).toContain('def read_events'); // IN reader
    expect(pyBus).toContain('def write_card'); // OUT card writer ($SCREEN_DIR)
    const pyServer = readFileSync(join(dir, 'apps/mcp/python/server.py'), 'utf-8');
    expect(pyServer).toContain('from channel_bus import read_events, write_card');
    expect(pyServer).toContain('present_card'); // OUT tool wired
    // live-push is an OPT-IN comment, never the default capability
    expect(pyServer).toContain('OPT-IN: live-push');
    // TS: tools:{} floor + both bus halves + opt-in push comment.
    const tsBus = readFileSync(join(dir, 'apps/mcp/ts/src/channel-bus.ts'), 'utf-8');
    expect(tsBus).toContain('export function readEvents'); // IN reader
    expect(tsBus).toContain('export function writeCard'); // OUT card writer
    const tsServer = readFileSync(join(dir, 'apps/mcp/ts/src/server.ts'), 'utf-8');
    expect(tsServer).toContain("capabilities: { tools: {} }"); // passive-bus floor, no push
    expect(tsServer).toContain("import { readEvents, writeCard } from './channel-bus.js'");
    expect(tsServer).toContain('present_card'); // OUT tool wired
    expect(tsServer).toContain('OPT-IN: live-push');
  });

  it('substitutes tokens in emitted server sources', () => {
    const dir = scaffold();
    const pyServer = readFileSync(join(dir, 'apps/mcp/python/server.py'), 'utf-8');
    const tsPkg = readFileSync(join(dir, 'apps/mcp/ts/package.json'), 'utf-8');
    expect(pyServer).toContain('mcp-proj-mcp'); // {{PROJECT_NAME}}-mcp resolved
    expect(pyServer).not.toContain('{{PROJECT_NAME}}');
    expect(tsPkg).toContain('@mcp-proj/mcp'); // {{PACKAGE_SCOPE}}/mcp resolved
    expect(tsPkg).not.toContain('{{');
  });
});
