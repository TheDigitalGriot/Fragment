import { existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

/**
 * The invariant gate: scripts/verify-fragment.mjs.
 *
 * Every command that prints "created" / "added" / "wired" runs this FIRST, so
 * the success line is a verdict rather than an assumption. A FAIL throws, which
 * blocks the print. A gate that cannot be located reports itself and does NOT
 * block — absence of evidence is not failure (the honesty rule the gate itself
 * follows).
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Locate the gate, preferring the copy that SHIPS WITH THIS PACKAGE.
 *
 * The in-package path is probed first and explicitly: a published
 * `create-fragment` install has no repo checkout around it, and package.json
 * "files" carries scripts/ precisely so the gate travels with the CLI. Falling
 * back to an upward walk keeps a repo checkout and a linked/hoisted install
 * working, without hardcoding a depth that rots when the build layout changes.
 *
 * HERE is <pkg>/dist/engine when built and <pkg>/src/engine under tsx, so two
 * levels up is the package root in both cases.
 */
export function resolveGate(): string | null {
  // 1. In-package (published install): <pkg>/scripts/verify-fragment.mjs
  const inPackage = join(HERE, '..', '..', 'scripts', 'verify-fragment.mjs');
  if (existsSync(inPackage)) return inPackage;

  // 2. Fallback: walk up for a checkout's scripts/ (repo-root shim included).
  let dir = HERE;
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'scripts', 'verify-fragment.mjs');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export interface GateOptions {
  projectDir: string;
  cmd: 'init' | 'add' | 'connect';
  /** Surfaces this command was ASKED for — I1 checks these, not whatever is on disk. */
  surfaces?: string[];
  templatesDir?: string;
}

/** Runs the gate. Throws on FAIL so the caller's success print never happens. */
export function runGate(options: GateOptions): void {
  const { projectDir, cmd, surfaces, templatesDir } = options;

  const gate = resolveGate();
  if (!gate) {
    console.warn(
      '[gate] scripts/verify-fragment.mjs not found — invariants UNVERIFIED for this run.',
    );
    return;
  }

  const args = [gate, resolve(projectDir), '--cmd', cmd];
  if (surfaces?.length) args.push('--surfaces', surfaces.join(','));
  if (templatesDir) args.push('--templates', templatesDir);

  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });

  if (result.error) {
    console.warn(`[gate] could not execute: ${result.error.message} — invariants UNVERIFIED.`);
    return;
  }
  if (result.status !== 0) {
    throw new Error(
      `Fragment invariant gate FAILED for \`fragment ${cmd}\` (see the table above). ` +
        'Nothing was claimed complete.',
    );
  }
}
