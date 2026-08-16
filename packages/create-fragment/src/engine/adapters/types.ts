/**
 * Adapter contract for the Fragment multi-target compiler.
 *
 * An Adapter lowers one SkillIR to one target's native package on disk and returns the list of
 * files it wrote (repo-relative to outDir). Adapters are pure emitters: they never mutate the IR
 * and never reach the network.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { SkillIR } from './ir.js';

export interface EmitOptions {
  /** Streamable-HTTP URL of the hosted MCP server backing the skill's tools. */
  mcpUrl?: string;
  /** Human app title for submission manifests; defaults to the skill name. */
  appTitle?: string;
  /** Reverse-DNS-ish app id for submission manifests. */
  appId?: string;
}

export interface Adapter {
  /** Stable target id used by the registry + CLI (`--target <id>`). */
  id: string;
  /** Human label. */
  label: string;
  /** False for guidance-only targets that produce NO installable artifact (Gemini, Custom GPT). */
  installable: boolean;
  /** Emit the target package into outDir; returns paths (relative to outDir) that were written. */
  emit(ir: SkillIR, outDir: string, opts?: EmitOptions): string[];
}

/** Write a file under outDir, creating parent dirs, and return its outDir-relative path. */
export function writeUnder(outDir: string, relPath: string, content: string): string {
  const abs = join(outDir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf-8');
  return relPath;
}
