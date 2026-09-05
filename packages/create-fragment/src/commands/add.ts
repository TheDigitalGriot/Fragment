import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { copyTemplate } from '../engine/copier.js';
import { buildTokenMap } from '../engine/tokens.js';
import { readManifest, updateWorkspaces } from '../engine/manifest.js';
import { getGitAuthorName } from '../utils/git.js';
import { runGate } from '../engine/gate.js';

export interface AddOptions {
  projectDir: string;
  templatesDir: string;
  surface: string;
  skipInstall?: boolean;
}

const VALID_SURFACES = ['electron', 'vscode', 'tui', 'mobile', 'mcp'];

export function runAdd(options: AddOptions): void {
  const { projectDir, templatesDir, surface, skipInstall } = options;

  if (!VALID_SURFACES.includes(surface)) {
    throw new Error(`Unknown surface: ${surface}. Valid: ${VALID_SURFACES.join(', ')}`);
  }

  // Verify this is a Fragment project
  const pkgPath = join(projectDir, 'package.json');
  if (!existsSync(pkgPath)) {
    throw new Error(`Not a Fragment project: no package.json in ${projectDir}`);
  }

  // Check surface doesn't already exist
  const surfaceDir = join(projectDir, 'apps', surface);
  if (existsSync(surfaceDir)) {
    throw new Error(`Surface "${surface}" already exists at ${surfaceDir}`);
  }

  // Read project name from existing package.json
  const rootPkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const projectName = rootPkg.name;
  const authorName = getGitAuthorName();
  const tokens = buildTokenMap(projectName, authorName);

  // Copy surface template
  const surfaceTemplateDir = join(templatesDir, surface);
  copyTemplate(surfaceTemplateDir, surfaceDir, tokens);

  // Update workspaces
  const manifest = readManifest(surfaceTemplateDir);
  if (manifest?.workspaceEntry) {
    updateWorkspaces(projectDir, manifest.workspaceEntry);
  }

  if (!skipInstall) {
    console.log('Installing dependencies...');
    execSync('npm install', { cwd: projectDir, stdio: 'inherit' });
  }

  // Gate BEFORE claiming success — a FAIL throws and the "added" line never prints.
  runGate({ projectDir, cmd: 'add', surfaces: [surface], templatesDir });

  console.log(`\nSurface "${surface}" added to ${projectDir}`);
}
