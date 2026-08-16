/**
 * Shared skill IR (intermediate representation) for the Fragment multi-target compiler.
 *
 * One IR is derived from a Fragment-emitted skill (SKILL.md + scripts/ + references/), then lowered
 * to each target's native package by a per-target adapter (see ./index.ts). The IR is deliberately
 * transport-agnostic: it carries WHAT the skill is (name, description, instructions, knowledge,
 * tools) and leaves HOW each platform packages it to the adapters.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, relative, basename } from 'path';

/** A tool the skill can call, normalized across MCP / OpenAI function / OpenAPI action shapes. */
export interface NormalizedTool {
  /** Tool id, e.g. `run_command`. Stable across every target. */
  name: string;
  /** One-line human description. Reused as OpenAPI summary / openai.yaml comment / hint justification. */
  description: string;
  /** JSON Schema for the arguments object. Empty object => no parameters. */
  inputSchema: Record<string, unknown>;
  /** OpenAI Apps submission hints. Default to a safe read-only posture when omitted. */
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
}

/** A file that ships alongside the skill body: a reference doc or an executable script. */
export interface KnowledgeFile {
  /** Path relative to the skill package root, e.g. `references/api.md` or `scripts/run.py`. */
  path: string;
  role: 'reference' | 'script';
  content: string;
}

/** The shared IR every adapter consumes. */
export interface SkillIR {
  name: string;
  description: string;
  /** Markdown body of SKILL.md (everything after the frontmatter). */
  instructions: string;
  knowledgeFiles: KnowledgeFile[];
  /** One-line statement of the skill's primary job; defaults to `name` if not derivable. */
  primaryCapability: string;
  tools: NormalizedTool[];
  /** Optional model hint carried through to the Claude emitter's frontmatter. */
  model?: string;
}

interface Frontmatter {
  fields: Record<string, string>;
  body: string;
}

/**
 * Parse a `---`-delimited YAML-ish frontmatter block without a YAML dependency. Only flat
 * `key: value` pairs are supported, which is all a SKILL.md header uses.
 */
export function parseFrontmatter(src: string): Frontmatter {
  const normalized = src.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { fields: {}, body: normalized.trim() };

  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return { fields, body: match[2].trim() };
}

function collectKnowledge(skillDir: string, sub: string, role: KnowledgeFile['role']): KnowledgeFile[] {
  const dir = join(skillDir, sub);
  if (!existsSync(dir)) return [];
  const out: KnowledgeFile[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (statSync(p).isDirectory()) {
        walk(p);
      } else {
        out.push({
          path: relative(skillDir, p).split('\\').join('/'),
          role,
          content: readFileSync(p, 'utf-8'),
        });
      }
    }
  };
  walk(dir);
  return out;
}

export interface BuildIROptions {
  /** Normalized tool specs for the skill (from an MCP surface, a tools.json, etc.). */
  tools?: NormalizedTool[];
  /** Override the derived primary capability. */
  primaryCapability?: string;
}

/**
 * Derive a SkillIR from an existing Fragment-emitted skill directory.
 *
 * Expects `<skillDir>/SKILL.md` with `name` + `description` frontmatter. `scripts/` and
 * `references/` (if present) become knowledgeFiles. Tools are supplied via opts (or a sibling
 * `tools.json`) since a plain skill folder does not declare them.
 */
export function buildIRFromSkill(skillDir: string, opts: BuildIROptions = {}): SkillIR {
  const skillPath = join(skillDir, 'SKILL.md');
  if (!existsSync(skillPath)) {
    throw new Error(`No SKILL.md found in ${skillDir}`);
  }
  const { fields, body } = parseFrontmatter(readFileSync(skillPath, 'utf-8'));
  const name = fields.name || basename(skillDir);
  const description = fields.description || '';

  let tools = opts.tools ?? [];
  const toolsJson = join(skillDir, 'tools.json');
  if (tools.length === 0 && existsSync(toolsJson)) {
    tools = JSON.parse(readFileSync(toolsJson, 'utf-8')) as NormalizedTool[];
  }

  return {
    name,
    description,
    instructions: body,
    knowledgeFiles: [
      ...collectKnowledge(skillDir, 'references', 'reference'),
      ...collectKnowledge(skillDir, 'scripts', 'script'),
    ],
    primaryCapability: opts.primaryCapability || description.split(/[.!?]/)[0].trim() || name,
    tools,
    model: fields.model,
  };
}

/** Load a serialized IR (`skill.ir.json`) straight from disk. */
export function loadIR(irPath: string): SkillIR {
  return JSON.parse(readFileSync(irPath, 'utf-8')) as SkillIR;
}

/** Apply safe default OpenAI hints: read-only, non-destructive, closed-world unless stated. */
export function withHintDefaults(tool: NormalizedTool): Required<Pick<NormalizedTool, 'readOnlyHint' | 'destructiveHint' | 'openWorldHint'>> {
  return {
    readOnlyHint: tool.readOnlyHint ?? true,
    destructiveHint: tool.destructiveHint ?? false,
    openWorldHint: tool.openWorldHint ?? false,
  };
}
