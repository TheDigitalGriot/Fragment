/**
 * Example local stdio MCP server for {{PROJECT_NAME}}, wired with no-orphan stdio hygiene AND the
 * bus-first channel transport by default. Replace the example tools with your real ones -- keep the
 * hygiene helpers and, if this server is a channel, keep the passive-bus tools.
 *
 * StdioServerTransport owns stdout for JSON-RPC (rule 1). Never console.log() in this process;
 * use log() (stderr) from ./hygiene.js for diagnostics.
 *
 * Channel transport (cl-plugin-structure -> references/channel-patterns.md -> "Transport Modes"):
 * this server is a PASSIVE BUS -- `capabilities: { tools: {} }` (no push capability) + filesystem
 * I/O via ./channel-bus.js. It therefore runs unchanged in a terminal, in Cowork cloud, and under
 * headless `claude -p`. Live-push is an OPT-IN interactive accelerator only -- see the commented
 * block at the bottom; never make a skill's correctness depend on a pushed reply arriving.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { findBinary, log, runChild } from './hygiene.js';
import { installReaper } from './launcher.js';
import { readEvents, writeCard } from './channel-bus.js';

// rule 5 (best-effort; see launcher.ts for the Windows Job Object caveat)
installReaper();

// Passive-bus channel server: the tools:{} floor is the load-bearing transport. Do NOT add
// `experimental['claude/channel']` here unless deliberately layering live-push on an
// interactive-only surface (and even then the bus stays the source of truth). See the opt-in
// note at the bottom of this file.
const server = new Server(
  { name: '{{PROJECT_NAME}}-mcp', version: '0.0.1' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'run_command',
      description: 'Run a helper binary with full stdio hygiene and return its stdout.',
      inputSchema: {
        type: 'object',
        properties: { args: { type: 'array', items: { type: 'string' } } },
        required: ['args'],
      },
    },
    // -- Passive-bus channel tools (headless- and Cowork-cloud-safe) --------------------
    {
      name: 'read_events',
      description:
        "Passive-bus IN: read this session's $STATE_DIR/events JSONL (rulings/events the " +
        'cockpit appended). Safe headless and in Cowork cloud.',
      inputSchema: {
        type: 'object',
        properties: {
          state_dir: {
            type: 'string',
            description: 'Explicit STATE_DIR; omit to auto-resolve (env -> newest session -> fallback).',
          },
          since: { type: 'integer', description: 'Skip the first N JSONL lines (a simple read cursor).' },
        },
      },
    },
    {
      name: 'present_card',
      description:
        "Passive-bus OUT: write an option card as HTML to this session's $SCREEN_DIR the " +
        'cockpit renders. Use this instead of AskUserQuestion when running headless.',
      inputSchema: {
        type: 'object',
        properties: {
          html: { type: 'string', description: 'Card HTML to render.' },
          name: { type: 'string', description: "Card file stem (default 'card')." },
          screen_dir: { type: 'string', description: 'Explicit SCREEN_DIR; omit to auto-resolve.' },
        },
        required: ['html'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  if (name === 'run_command') {
    const args = (req.params.arguments as { args: string[] }).args;
    // rule 4: resolve the binary bundled-first (before PATH)
    const binary = findBinary(args[0]);
    // rules 1,2,3: stdin ignored, stdout captured (not leaked to the server's stdout), env sanitized
    const result = await runChild(binary, args.slice(1), { timeoutMs: 30_000 });
    if (result.code !== 0) {
      log(`run_command: ${args[0]} exited ${result.code}: ${result.stderr.slice(0, 200)}`);
    }
    // child stdout returned as a structured tool RESULT -- never written to stdout (rule 1)
    return { content: [{ type: 'text', text: result.stdout }] };
  }
  if (name === 'read_events') {
    const a = req.params.arguments as { state_dir?: string; since?: number };
    const events = readEvents(a.state_dir, a.since ?? 0);
    return { content: [{ type: 'text', text: JSON.stringify(events) }] };
  }
  if (name === 'present_card') {
    const a = req.params.arguments as { html: string; name?: string; screen_dir?: string };
    const dest = writeCard(a.html, a.name ?? 'card', a.screen_dir);
    return { content: [{ type: 'text', text: `card written: ${dest}` }] };
  }
  throw new Error(`unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);

// --- OPT-IN: live-push (interactive surfaces only) -----------------------------------------
// The passive bus above is the load-bearing transport and runs everywhere. If (and only if) this
// channel targets an INTERACTIVE surface that benefits from real-time wake / phone-relay, you may
// ADD live-push on top -- it is inert headless, so it must never be the path correctness depends on.
// To opt in, declare the experimental capability and push events:
//
//   const server = new Server(
//     { name: '{{PROJECT_NAME}}-mcp', version: '0.0.1' },
//     { capabilities: { experimental: { 'claude/channel': {} }, tools: {} } },
//   );
//   // ... then, when an external event arrives on an interactive session:
//   // await server.notification({
//   //   method: 'notifications/claude/channel',
//   //   params: { content: 'build failed on main', meta: { severity: 'high' } },
//   // });
//
// Keep the bus tools regardless -- push accelerates the interactive case; the bus keeps the same
// server correct headless and in Cowork cloud.
