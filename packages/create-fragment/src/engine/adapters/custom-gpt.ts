/**
 * Custom GPT adapter (guidance / manual-builder target — NO installable artifact).
 *
 * A Custom GPT is assembled by hand in the GPT builder from three inputs, which we generate:
 *   - openapi-actions.json — an OpenAPI 3.1 Actions schema derived from tools[] (one POST op per
 *     tool). Kept well under the builder limits (<=~1MB, <=30 operations).
 *   - instructions.txt — the system instructions (from the IR instructions body).
 *   - knowledge-manifest.json — a checklist of files to upload as Knowledge (from knowledgeFiles).
 */
import type { SkillIR, NormalizedTool } from './ir.js';
import type { Adapter, EmitOptions } from './types.js';
import { writeUnder } from './types.js';

const MAX_OPERATIONS = 30;
const DEFAULT_SERVER = 'https://example.com';

function opId(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, '_');
}

function operation(t: NormalizedTool) {
  return {
    post: {
      operationId: opId(t.name),
      summary: t.description,
      requestBody: {
        required: Object.keys((t.inputSchema?.properties as object) ?? {}).length > 0,
        content: {
          'application/json': {
            schema: t.inputSchema && Object.keys(t.inputSchema).length > 0 ? t.inputSchema : { type: 'object' },
          },
        },
      },
      responses: { '200': { description: 'Success' } },
    },
  };
}

function buildOpenApi(ir: SkillIR, server: string) {
  const tools = ir.tools.slice(0, MAX_OPERATIONS);
  const paths: Record<string, unknown> = {};
  for (const t of tools) {
    paths[`/${opId(t.name)}`] = operation(t);
  }
  return {
    openapi: '3.1.0',
    info: { title: `${ir.name} Actions`, description: ir.description, version: '1.0.0' },
    servers: [{ url: server }],
    paths,
  };
}

export const customGptAdapter: Adapter = {
  id: 'custom-gpt',
  label: 'Custom GPT (manual builder)',
  installable: false,
  emit(ir: SkillIR, outDir: string, opts?: EmitOptions): string[] {
    const server = opts?.mcpUrl ?? DEFAULT_SERVER;
    const written: string[] = [];

    const openapi = buildOpenApi(ir, server);
    written.push(writeUnder(outDir, 'openapi-actions.json', JSON.stringify(openapi, null, 2) + '\n'));

    if (ir.tools.length > MAX_OPERATIONS) {
      written.push(
        writeUnder(
          outDir,
          'ACTIONS-NOTE.txt',
          `NOTE: ${ir.tools.length} tools exceed the Custom GPT ${MAX_OPERATIONS}-operation ceiling; ` +
            `only the first ${MAX_OPERATIONS} were emitted into openapi-actions.json.\n`,
        ),
      );
    }

    written.push(writeUnder(outDir, 'instructions.txt', ir.instructions.trim() + '\n'));

    const knowledge = {
      note: 'Upload each file below as Knowledge in the Custom GPT builder (manual step).',
      capability: ir.primaryCapability,
      files: ir.knowledgeFiles.map((k) => ({ path: k.path, role: k.role })),
    };
    written.push(writeUnder(outDir, 'knowledge-manifest.json', JSON.stringify(knowledge, null, 2) + '\n'));

    return written;
  },
};
