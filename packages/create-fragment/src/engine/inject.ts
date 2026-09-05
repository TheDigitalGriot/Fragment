import { existsSync, readFileSync, writeFileSync } from 'fs';

/**
 * Entry-point injection for `fragment connect`.
 *
 * WHY THIS EXISTS
 * ---------------
 * `connect` used to WRITE glue files and then print "Wired surfaces" — but
 * nothing ever imported them, so the glue was dead code and the claim was a
 * document rather than a control. Invariant I3b (scripts/verify-fragment.mjs)
 * now checks that claim, and this module is what makes it true: each glue-
 * bearing surface's entry point gets the import and the call.
 *
 * IDEMPOTENCY
 * -----------
 * Every injected region carries GLUE_MARKER. Its presence in a file is the
 * whole idempotency check: re-running `connect` on an already-wired entry point
 * makes no second edit, so imports and calls never duplicate. The injected
 * content deliberately references only STABLE symbols (an aggregator, not a
 * per-MCP-server function), so a marker hit is always a correct skip.
 */

/** Written into every injected region; presence == "already wired". */
export const GLUE_MARKER = 'fragment:plugin-glue';

const BANNER = `${GLUE_MARKER} — wired by \`fragment connect\`; do not edit this block.`;

export interface EntryInjection {
  /** Absolute path to the surface's entry point. */
  file: string;
  /** Import statements added below the file's existing imports. */
  imports: string[];
  /** Statements inserted after `anchor`, or appended at EOF when absent. */
  body: string[];
  /**
   * Insert `body` directly after the LAST line matching this pattern. When it
   * does not match, the body is appended at EOF instead — which is correct for
   * module-scope entry points (renderer.tsx) and wrong for function-scope ones,
   * so callers that REQUIRE an anchor pass `anchorRequired`.
   */
  anchor?: RegExp;
  /** Skip injection entirely when `anchor` does not match (no EOF fallback). */
  anchorRequired?: boolean;
  /** Indentation applied to each body line (function-scope injections). */
  indent?: string;
}

export interface InjectionResult {
  file: string;
  /** true when the entry point now carries the glue wiring. */
  wired: boolean;
  /** 'injected' | 'already-wired' | 'missing-entry' | 'anchor-not-found' */
  status: 'injected' | 'already-wired' | 'missing-entry' | 'anchor-not-found';
}

/** Index just past the file's leading import block (0 when there is none). */
function afterImports(lines: string[]): number {
  let last = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*import\s/.test(l) || /^\s*}\s*from\s+['"]/.test(l)) last = i;
    // Stop scanning once real code starts, so a later `import()` never counts.
    if (last !== -1 && /^\s*(const|let|var|function|class|export|app\.)/.test(l)) break;
  }
  return last + 1;
}

/** Index of the LAST line matching `re`, or -1. */
function lastMatch(lines: string[], re: RegExp): number {
  for (let i = lines.length - 1; i >= 0; i--) if (re.test(lines[i])) return i;
  return -1;
}

/**
 * Inject an import + a call into a TypeScript/TSX entry point, idempotently.
 * Returns what happened so `connect` can report wiring honestly instead of
 * assuming it.
 */
export function injectEntry(injection: EntryInjection): InjectionResult {
  const { file, imports, body, anchor, anchorRequired, indent = '' } = injection;

  if (!existsSync(file)) return { file, wired: false, status: 'missing-entry' };

  const original = readFileSync(file, 'utf-8');
  if (original.includes(GLUE_MARKER)) {
    return { file, wired: true, status: 'already-wired' };
  }

  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.split(/\r?\n/);

  const anchorAt = anchor ? lastMatch(lines, anchor) : -1;
  if (anchor && anchorAt === -1 && anchorRequired) {
    return { file, wired: false, status: 'anchor-not-found' };
  }

  const bodyBlock = [`${indent}// ${BANNER}`, ...body.map((l) => (l ? `${indent}${l}` : l))];
  const importBlock = [`// ${BANNER}`, ...imports];

  // Splice the LATER insertion first so the earlier index stays valid.
  const importAt = afterImports(lines);
  if (anchorAt !== -1) {
    lines.splice(anchorAt + 1, 0, ...bodyBlock);
    lines.splice(importAt, 0, ...importBlock);
  } else {
    lines.splice(importAt, 0, ...importBlock);
    if (lines[lines.length - 1]?.trim() !== '') lines.push('');
    lines.push(...bodyBlock, '');
  }

  writeFileSync(file, lines.join(eol), 'utf-8');
  return { file, wired: true, status: 'injected' };
}

/**
 * Inject a Go import + a call into a Go entry point, idempotently.
 *
 * Go needs its own path: imports live inside an `import ( ... )` block rather
 * than at top level, and the import path is the MODULE path plus the package
 * directory, which has to be read out of go.mod.
 */
export function injectGoEntry(options: {
  /** Absolute path to the Go entry point (main.go). */
  file: string;
  /** Absolute path to the module's go.mod (or go.mod.tmpl-emitted go.mod). */
  goModPath: string;
  /** Package directory relative to the module root, e.g. 'plugin-glue'. */
  packageDir: string;
  /** Package name declared in that directory, e.g. 'pluginglue'. */
  packageName: string;
  /** Statements inserted after `anchor`. */
  body: string[];
  anchor: RegExp;
  indent?: string;
}): InjectionResult {
  const { file, goModPath, packageDir, packageName, body, anchor, indent = '\t\t\t' } = options;

  if (!existsSync(file) || !existsSync(goModPath)) {
    return { file, wired: false, status: 'missing-entry' };
  }

  const original = readFileSync(file, 'utf-8');
  if (original.includes(GLUE_MARKER)) {
    return { file, wired: true, status: 'already-wired' };
  }

  const moduleLine = readFileSync(goModPath, 'utf-8').match(/^module\s+(\S+)/m);
  if (!moduleLine) return { file, wired: false, status: 'missing-entry' };
  const importPath = `${moduleLine[1]}/${packageDir}`;

  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.split(/\r?\n/);

  const anchorAt = lastMatch(lines, anchor);
  if (anchorAt === -1) return { file, wired: false, status: 'anchor-not-found' };

  // Closing paren of the `import (` block.
  const importOpen = lines.findIndex((l) => /^import\s*\($/.test(l.trim()));
  if (importOpen === -1) return { file, wired: false, status: 'anchor-not-found' };
  let importClose = -1;
  for (let i = importOpen + 1; i < lines.length; i++) {
    if (lines[i].trim() === ')') { importClose = i; break; }
  }
  if (importClose === -1) return { file, wired: false, status: 'anchor-not-found' };

  const bodyBlock = [`${indent}// ${BANNER}`, ...body.map((l) => (l ? `${indent}${l}` : l))];
  const importBlock = [`\t// ${BANNER}`, `\t${packageName} "${importPath}"`];

  lines.splice(anchorAt + 1, 0, ...bodyBlock);
  lines.splice(importClose, 0, ...importBlock);

  writeFileSync(file, lines.join(eol), 'utf-8');
  return { file, wired: true, status: 'injected' };
}
