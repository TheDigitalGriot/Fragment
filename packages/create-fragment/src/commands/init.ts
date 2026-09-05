import { join } from 'path';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { copyTemplate } from '../engine/copier.js';
import { buildTokenMap, type TokenMap } from '../engine/tokens.js';
import { readManifest, updateWorkspaces } from '../engine/manifest.js';
import { runGate } from '../engine/gate.js';

export interface InitOptions {
  name: string;
  outputDir: string;
  templatesDir: string;
  surfaces: string[];
  authorName: string;
  skipInstall?: boolean;
}

const VALID_SURFACES = ['electron', 'vscode', 'tui', 'mobile', 'mcp'];

export function runInit(options: InitOptions): void {
  const { name, outputDir, templatesDir, surfaces, authorName, skipInstall } = options;

  // Validate surfaces
  for (const surface of surfaces) {
    if (!VALID_SURFACES.includes(surface)) {
      throw new Error(`Unknown surface: ${surface}. Valid: ${VALID_SURFACES.join(', ')}`);
    }
  }

  if (existsSync(outputDir)) {
    throw new Error(`Directory already exists: ${outputDir}`);
  }

  const tokens = buildTokenMap(name, authorName);

  // 1. Copy base template → project root
  copyTemplate(join(templatesDir, 'base'), outputDir, tokens);

  // 2. Copy core → packages/core/
  copyTemplate(
    join(templatesDir, 'core'),
    join(outputDir, 'packages', 'core'),
    tokens,
  );

  // 3. Copy ui → packages/ui/
  copyTemplate(
    join(templatesDir, 'ui'),
    join(outputDir, 'packages', 'ui'),
    tokens,
  );

  // 4. Copy each selected surface → apps/<surface>/
  for (const surface of surfaces) {
    const surfaceTemplateDir = join(templatesDir, surface);
    const surfaceOutputDir = join(outputDir, 'apps', surface);

    copyTemplate(surfaceTemplateDir, surfaceOutputDir, tokens);

    // Read manifest for workspace entry
    const manifest = readManifest(surfaceTemplateDir);
    if (manifest?.workspaceEntry) {
      updateWorkspaces(outputDir, manifest.workspaceEntry);
    }
  }

  // 5. Run npm install (unless skipped for testing)
  if (!skipInstall) {
    console.log('Installing dependencies...');
    execSync('npm install', { cwd: outputDir, stdio: 'inherit' });
  }

  // 6. Gate BEFORE claiming success — a FAIL throws and the "created" line never prints.
  runGate({ projectDir: outputDir, cmd: 'init', surfaces, templatesDir });

  console.log(`\nFragment project "${name}" created at ${outputDir}`);
  console.log(`Surfaces: ${surfaces.join(', ')}`);
  console.log('\nNext steps:');
  console.log(`  cd ${name}`);
  if (!skipInstall) {
    console.log('  npm install');
  }
  console.log('  # Start building!');
}
