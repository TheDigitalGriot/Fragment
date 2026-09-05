import { join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { discoverPlugin, detectSurfaces } from '../engine/plugin-discovery.js';
import { runGate } from '../engine/gate.js';
import { generateElectronGlue } from '../engine/generators/electron-glue.js';
import { generateVSCodeGlue } from '../engine/generators/vscode-glue.js';
import { generateTuiGlue } from '../engine/generators/tui-glue.js';
import { generateMobileGlue } from '../engine/generators/mobile-glue.js';

export interface ConnectOptions {
  projectDir: string;
}

export interface ConnectResult {
  plugin: string;
  surfaces: string[];
  files: Record<string, string[]>;
}

export function runConnect(options: ConnectOptions): ConnectResult {
  const { projectDir } = options;

  const plugin = discoverPlugin(projectDir);
  if (!plugin) {
    throw new Error(
      'No plugin found. Expected .claude-plugin/plugin.json at project root or in plugins/*/',
    );
  }

  const surfaces = detectSurfaces(projectDir);
  if (surfaces.length === 0) {
    throw new Error(
      'No surfaces found. Run `fragment init` first to create apps/.',
    );
  }

  const files: Record<string, string[]> = {};

  for (const surface of surfaces) {
    const surfaceDir = join(projectDir, 'apps', surface);

    switch (surface) {
      case 'electron':
        files.electron = generateElectronGlue(surfaceDir, plugin);
        break;
      case 'vscode':
        files.vscode = generateVSCodeGlue(surfaceDir, plugin);
        break;
      case 'tui':
        files.tui = generateTuiGlue(surfaceDir, plugin);
        break;
      case 'mobile':
        files.mobile = generateMobileGlue(surfaceDir, plugin);
        break;
    }
  }

  const result: ConnectResult = { plugin: plugin.name, surfaces, files };

  // Publish what we CLAIM we wired, then let the gate check that claim against
  // disk (files exist, something imports them, the surface still builds) before
  // a single "Wired surfaces" line is printed. A FAIL throws.
  const stateDir = join(projectDir, '.fragment');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, 'connect-result.json'),
    JSON.stringify(result, null, 2) + '\n',
    'utf-8',
  );
  runGate({ projectDir, cmd: 'connect', surfaces });

  console.log(`\nFragment Connect: ${plugin.name}`);
  console.log(`MCP Servers: ${Object.keys(plugin.mcpServers).join(', ')}`);
  console.log(`\nWired surfaces:`);
  for (const [surface, surfaceFiles] of Object.entries(files)) {
    console.log(`  ${surface}:`);
    for (const f of surfaceFiles) {
      console.log(`    + ${f}`);
    }
  }
  console.log(`\nNext steps:`);
  console.log(`  Each surface's entry point already imports and calls its glue`);
  console.log(`  (marked "fragment:plugin-glue"); invariant I3b above verified it.`);
  console.log(`  See apps/<surface>/**/plugin-glue/ for the generated files.`);

  return result;
}
