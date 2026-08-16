/**
 * ChatGPT Skills adapter.
 *
 * ChatGPT Skills reuse Claude's exact folder shape (SKILL.md + references/ + scripts/) — ~90% shared
 * with claude.ts via emitSkillFolder — and add ONE sidecar: `agents/openai.yaml`. That sidecar
 * declares the skill's MCP tool dependencies over transport `streamable_http` and, critically,
 * `allow_implicit_invocation: false` so the skill is only ever run when the user explicitly invokes
 * it (never auto-fired mid-conversation). See the 2026-08-06 multiharness research.
 */
import type { SkillIR } from './ir.js';
import type { Adapter, EmitOptions } from './types.js';
import { emitSkillFolder, renderSkillMarkdown } from './skill-folder.js';
import { writeUnder } from './types.js';

const DEFAULT_MCP_URL = 'https://example.com/mcp';

/** Serialize the openai.yaml sidecar by hand (no YAML dep) for its fixed, known shape. */
function renderOpenAiYaml(ir: SkillIR, mcpUrl: string): string {
  const lines: string[] = [
    `name: ${ir.name}`,
    `description: ${yamlScalar(ir.description)}`,
    // The load-bearing flag: user-invoked only, never implicitly auto-fired.
    'allow_implicit_invocation: false',
  ];

  if (ir.tools.length > 0) {
    lines.push('mcp_servers:');
    lines.push('  - transport: streamable_http');
    lines.push(`    url: ${yamlScalar(mcpUrl)}`);
    lines.push('    tools:');
    for (const t of ir.tools) {
      lines.push(`      - name: ${t.name}`);
      lines.push(`        description: ${yamlScalar(t.description)}`);
    }
  } else {
    lines.push('mcp_servers: []');
  }
  return lines.join('\n') + '\n';
}

/** Quote a scalar if it contains YAML-significant characters; otherwise pass through. */
function yamlScalar(v: string): string {
  return /[:#\-?{}\[\],&*!|>'"%@`]/.test(v) || v.trim() !== v
    ? `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    : v;
}

export const chatgptSkillsAdapter: Adapter = {
  id: 'chatgpt-skills',
  label: 'ChatGPT Skills',
  installable: true,
  emit(ir: SkillIR, outDir: string, opts?: EmitOptions): string[] {
    const written = emitSkillFolder(ir, outDir);
    const mcpUrl = opts?.mcpUrl ?? DEFAULT_MCP_URL;
    written.push(writeUnder(outDir, 'agents/openai.yaml', renderOpenAiYaml(ir, mcpUrl)));
    return written;
  },
};

// Re-export for callers/tests that want the raw SKILL.md string without touching disk.
export { renderSkillMarkdown };
