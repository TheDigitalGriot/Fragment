/**
 * ChatGPT Apps (Apps SDK) adapter.
 *
 * An App is a hosted MCP server + a `chatgpt-app-submission.json`. We reuse Fragment's existing
 * `apps/mcp/` surface as the hosted server (referenced by URL), and generate the submission manifest:
 *   - schema_version: 1
 *   - app_info (name, description, hosted server URL)
 *   - per-tool annotations: readOnlyHint / destructiveHint / openWorldHint + a justification.
 *     Missing hints are hard submission blockers, so withHintDefaults() guarantees all three.
 *   - test_cases: >= 5 positive + 3 negative stubs (also a submission requirement).
 */
import type { SkillIR, NormalizedTool } from './ir.js';
import { withHintDefaults } from './ir.js';
import type { Adapter, EmitOptions } from './types.js';
import { writeUnder } from './types.js';

const DEFAULT_MCP_URL = 'https://example.com/mcp';

function toolEntry(t: NormalizedTool) {
  const hints = withHintDefaults(t);
  return {
    name: t.name,
    description: t.description,
    annotations: {
      readOnlyHint: hints.readOnlyHint,
      destructiveHint: hints.destructiveHint,
      openWorldHint: hints.openWorldHint,
    },
    justification:
      `${t.name} is ${hints.readOnlyHint ? 'read-only' : 'state-changing'}` +
      `${hints.destructiveHint ? ' and destructive' : ''}` +
      `${hints.openWorldHint ? ', reaching external/open-world resources' : ', operating on closed-world app state'}. ` +
      `Purpose: ${t.description}`,
  };
}

/** Build >=5 positive + >=3 negative test-case stubs, seeded from the tools + capability. */
function testCases(ir: SkillIR) {
  const cap = ir.primaryCapability;
  const positive: Array<{ prompt: string; expected: string }> = [
    { prompt: `Use ${ir.name} to ${cap}.`, expected: `The app invokes its tools and completes: ${cap}.` },
    { prompt: `Can you ${cap} for me?`, expected: `The app performs ${cap} via its MCP tools.` },
    { prompt: `Walk me through ${cap} step by step.`, expected: `The app explains and executes ${cap}.` },
  ];
  for (const t of ir.tools.slice(0, 3)) {
    positive.push({
      prompt: `Please run ${t.name}: ${t.description}`,
      expected: `The app calls ${t.name} and returns its result.`,
    });
  }
  // Guarantee the >=5 floor even when the skill declares few/no tools.
  while (positive.length < 5) {
    positive.push({
      prompt: `Help me with ${ir.name} (${cap}) — example ${positive.length + 1}.`,
      expected: `The app handles the ${cap} request.`,
    });
  }

  const negative = [
    { prompt: 'What is the weather tomorrow?', expected: 'The app declines — out of scope for this skill.' },
    { prompt: 'Delete all my files.', expected: 'The app refuses — no such capability / not authorized.' },
    { prompt: 'Tell me a joke unrelated to this app.', expected: 'The app stays on task and does not invoke tools.' },
  ];
  return { positive, negative };
}

export const chatgptAppsAdapter: Adapter = {
  id: 'chatgpt-apps',
  label: 'ChatGPT Apps (Apps SDK)',
  installable: true,
  emit(ir: SkillIR, outDir: string, opts?: EmitOptions): string[] {
    const mcpUrl = opts?.mcpUrl ?? DEFAULT_MCP_URL;
    const { positive, negative } = testCases(ir);
    const submission = {
      schema_version: 1,
      app_info: {
        id: opts?.appId ?? `com.fragment.${ir.name}`,
        name: opts?.appTitle ?? ir.name,
        description: ir.description,
        // Fragment's existing apps/mcp/ surface is the hosted server for this App.
        hosted_server: { transport: 'streamable_http', url: mcpUrl, source: 'apps/mcp' },
      },
      tools: ir.tools.map(toolEntry),
      test_cases: { positive, negative },
    };
    return [writeUnder(outDir, 'chatgpt-app-submission.json', JSON.stringify(submission, null, 2) + '\n')];
  },
};
