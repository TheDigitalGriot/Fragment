/**
 * Passive-bus channel transport for a local stdio MCP server (the DEFAULT transport).
 *
 * Two transports exist on the channel primitive (cl-plugin-structure ->
 * references/channel-patterns.md -> "Transport Modes -- Live-Push vs Passive Bus"):
 *
 *   * PASSIVE BUS (this module, bus-first + load-bearing) -- the server declares only
 *     `capabilities: { tools: {} }` and moves events through the FILESYSTEM:
 *         OUT  option cards written as HTML to a per-session $SCREEN_DIR the cockpit renders
 *         IN   rulings/events read as JSONL from $STATE_DIR/events
 *     Nothing depends on a live notification listener, so the SAME server runs unchanged in
 *     an interactive terminal, in Cowork cloud, and under headless `claude -p`. Build here
 *     first; never gate a skill's correctness on anything but the bus.
 *
 *   * LIVE-PUSH (opt-in, interactive-only) -- `experimental["claude/channel"]` + the
 *     `notifications/claude/channel` method. Needs a live consumer attached to the session;
 *     inert headless. Layer it on ONLY for interactive surfaces (phone-relay, real-time wake)
 *     as an accelerator, never the load-bearing path. See the commented opt-in block in server.ts.
 *
 * Reference server: prism scripts/digital-griot-mcp/digital-griot-mcp.ts.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Base dir under which per-session dirs live; override with $GRIOT_BUS_ROOT. */
function busRoot(): string {
  return process.env.GRIOT_BUS_ROOT ?? join(tmpdir(), '{{PROJECT_NAME}}-bus');
}

function newestSessionDir(base: string): string | null {
  if (!existsSync(base)) return null;
  const dirs = readdirSync(base)
    .map((e) => join(base, e))
    .filter((p) => {
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
  if (dirs.length === 0) return null;
  return dirs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

/** STATE_DIR precedence (channel-patterns.md): explicit -> $STATE_DIR -> newest session dir
 * -> fallback. The fallback is created so reads/writes never throw. */
export function resolveStateDir(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.STATE_DIR) return process.env.STATE_DIR;
  const newest = newestSessionDir(busRoot());
  if (newest) return newest;
  const fallback = join(busRoot(), 'default');
  mkdirSync(fallback, { recursive: true });
  return fallback;
}

/** SCREEN_DIR precedence mirrors STATE_DIR: explicit -> $SCREEN_DIR -> <stateDir>/screen. */
export function resolveScreenDir(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.SCREEN_DIR) return process.env.SCREEN_DIR;
  return join(resolveStateDir(), 'screen');
}

/** IN half -- read $STATE_DIR/events as JSONL, returning parsed records from line `since` on.
 * A malformed / partially-written tail line is skipped, never thrown, so a reader that races
 * the writer is safe. Returns [] when no events file exists yet. */
export function readEvents(stateDir?: string, since = 0): unknown[] {
  const path = join(resolveStateDir(stateDir), 'events');
  if (!existsSync(path)) return [];
  const out: unknown[] = [];
  const lines = readFileSync(path, 'utf-8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (i < since) continue;
    const line = lines[i].trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* skip a partial tail line */
    }
  }
  return out;
}

/** OUT half -- write an option card as HTML to $SCREEN_DIR the cockpit renders. Written
 * temp-then-rename so a reader never observes a half-written card. Returns the path. */
export function writeCard(html: string, name = 'card', screenDir?: string): string {
  const sdir = resolveScreenDir(screenDir);
  mkdirSync(sdir, { recursive: true });
  const dest = join(sdir, `${name}.html`);
  const tmp = join(sdir, `.${name}.html.tmp`);
  writeFileSync(tmp, html, 'utf-8');
  renameSync(tmp, dest);
  return dest;
}
