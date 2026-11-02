/**
 * ChatGPT Skills adapter (also the format Codex reads).
 *
 * ChatGPT Skills reuse Claude's exact folder shape (SKILL.md + references/ + scripts/), so ~90% is
 * shared with claude.ts via emitSkillFolder. They add ONE optional sidecar inside the skill folder:
 * `skills/<name>/agents/openai.yaml`.
 *
 * Schema source (read 2026-11-01): https://learn.chatgpt.com/docs/build-skills
 *   my-skill/agents/openai.yaml  "Optional: appearance and dependencies"
 *   top-level sections: interface, policy, dependencies (all optional)
 *   interface:    display_name, short_description, icon_small, icon_large, brand_color, default_prompt
 *   policy:       allow_implicit_invocation (default: true)
 *   dependencies: tools[] of { type: "mcp", value, description, transport: "streamable_http", url }
 * `name` and `description` are NOT openai.yaml fields; they live in SKILL.md frontmatter only.
 *
 * Every value is mapped from the IR. Nothing is hardcoded policy: implicit invocation follows
 * ir.allowImplicitInvocation and falls back to the doc's default (true).
 */
import type { SkillIR } from './ir.js';
import type { Adapter, EmitOptions } from './types.js';
import { emitSkillFolder, renderSkillMarkdown } from './skill-folder.js';
import { writeUnder } from './types.js';

const DEFAULT_MCP_URL = 'https://example.com/mcp';
/** The doc's stated default for policy.allow_implicit_invocation. */
const DOC_DEFAULT_IMPLICIT = true;

/** Serialize the openai.yaml sidecar by hand (no YAML dep) for its fixed, known shape. */
export function renderOpenAiYaml(ir: SkillIR, opts: EmitOptions = {}): string {
  const lines: string[] = ['interface:'];
  if (opts.appTitle) lines.push(`  display_name: ${yamlScalar(opts.appTitle)}`);
  lines.push(`  short_description: ${yamlScalar(ir.primaryCapability || ir.name)}`);

  lines.push('policy:');
  lines.push(`  allow_implicit_invocation: ${ir.allowImplicitInvocation ?? DOC_DEFAULT_IMPLICIT}`);

  // dependencies is optional in the doc; emit it only when the skill actually needs a tool.
  if (ir.tools.length > 0) {
    const toolNames = ir.tools.map((t) => t.name).join(', ');
    lines.push('dependencies:');
    lines.push('  tools:');
    lines.push('    - type: "mcp"');
    lines.push(`      value: ${yamlScalar(ir.name)}`);
    lines.push(`      description: ${yamlScalar(`MCP server for ${ir.name} (tools: ${toolNames})`)}`);
    lines.push('      transport: "streamable_http"');
    lines.push(`      url: ${yamlScalar(opts.mcpUrl ?? DEFAULT_MCP_URL)}`);
  }
  return lines.join('\n') + '\n';
}

/** Quote a scalar if it contains YAML-significant characters; otherwise pass through. */
function yamlScalar(v: string): string {
  return /[:#\-?{}\[\],&*!|>'"%@`]/.test(v) || v.trim() !== v || v === ''
    ? `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    : v;
}

export const chatgptSkillsAdapter: Adapter = {
  id: 'chatgpt-skills',
  label: 'ChatGPT Skills',
  installable: true,
  emit(ir: SkillIR, outDir: string, opts?: EmitOptions): string[] {
    const written = emitSkillFolder(ir, outDir);
    // The doc places agents/ as a sibling of SKILL.md inside the skill folder.
    written.push(writeUnder(outDir, `skills/${ir.name}/agents/openai.yaml`, renderOpenAiYaml(ir, opts)));
    return written;
  },
};

// Re-export for callers/tests that want the raw SKILL.md string without touching disk.
export { renderSkillMarkdown };
