# {{PROJECT_NAME}} — local stdio MCP server

A scaffold for a **local stdio MCP server** that ships the **no-orphan stdio hygiene standard**
AND the **bus-first channel transport** by default. Two interchangeable variants are emitted —
pick one, delete the other:

- `python/` — the reference implementation (mirrors Cinopsis v2.1.3, which proved the standard).
  Native Windows `KILL_ON_JOB_CLOSE` Job Object launcher. Passive bus in `python/channel_bus.py`.
- `ts/` — a `@modelcontextprotocol/sdk` server for TS-native stacks. Portable child-reaper
  (see `ts/src/launcher.ts` for the honest Windows Job Object caveat). Passive bus in
  `ts/src/channel-bus.ts`.

## Channel transport — bus-first (headless / Cowork-cloud safe)

If this server is a **channel** (pushes external events into a Claude session), it is scaffolded
on the **passive bus** — the load-bearing transport per `cl-plugin-structure` →
`references/channel-patterns.md` → "Transport Modes — Live-Push vs Passive Bus". There are two
transports on the channel primitive:

- **Passive bus (default, this scaffold).** The server declares only `capabilities: { tools: {} }`
  (no push capability) and moves events through the **filesystem**:
  - **OUT** — `present_card` writes an option card as HTML to a per-session `$SCREEN_DIR` the
    cockpit renders.
  - **IN** — `read_events` reads rulings/events as JSONL from `$STATE_DIR/events`.

  Because nothing depends on a live notification listener, the **same server runs unchanged** in
  an interactive terminal, in **Cowork cloud**, and under headless `claude -p`. `STATE_DIR`
  resolution precedence: explicit arg → `$STATE_DIR` env → newest session dir → fallback.

- **Live-push (opt-in, interactive-only).** `experimental["claude/channel"]` + the
  `notifications/claude/channel` method. It needs a live interactive consumer attached to the
  session, so it is **inert headless**. Layer it on **only** for interactive surfaces
  (phone-relay, real-time wake) as an accelerator — see the commented opt-in block at the bottom
  of `server.py` / `server.ts`.

**The Griot rule:** build on the passive bus first; live-push is an optional accelerator, never
load-bearing. **No emitted skill may gate its correctness on a pushed reply arriving.** Reference
server: prism `scripts/digital-griot-mcp/digital-griot-mcp.ts`.

## The standard both variants enforce

A local stdio MCP server talks JSON-RPC over **stdout**, so any child process it shells out to
can corrupt the protocol or hang the server. The 5 rules (source:
`cl-plugin-structure` → `references/mcp-patterns.md` → "Local stdio server hygiene"):

1. **stdout is sacred** — it *is* the JSON-RPC channel. Never let a shelled-out child write to
   it; route wrapped-subprocess output to stderr or return it as a structured tool result.
2. **`stdin = DEVNULL`** on every shelled-out child. On Windows a child otherwise inherits the
   server's stdin JSON-RPC pipe and blocks until timeout — the 60s hang (python-sdk #671,
   CPython #19575).
3. **Sanitize the child env** — strip `HTTP/HTTPS/ALL_PROXY`/`NO_PROXY` the host or VM may inject.
4. **Interpreter-first binary resolution** — prefer a bundled/venv binary over PATH/user-site.
5. **`KILL_ON_JOB_CLOSE` launcher** — bind the server child to a Windows Job Object so the host
   reaps it instead of orphaning it.

**Anti-patterns:** no second stdin reader (corrupts the protocol); no pre-spawn process scan
(risks the ~5s spawn timeout, #61524).

## Wire it into your plugin

Add to your plugin `.mcp.json` (Python variant shown — it self-reaps via the launcher):

```json
{
  "mcpServers": {
    "{{PROJECT_NAME}}": { "command": "python", "args": ["apps/mcp/python/mcp_launcher.py"] }
  }
}
```

Then replace the example `run_command` tool with your real tools — **keep the hygiene helpers**.

## The `icm_prism_run` tool (Prism-image)

Both variants also expose **`icm_prism_run`** — a launcher that starts a **Prism ICM stage-walk**
headless: it spawns `claude -p` with a *thin router prompt* that reads a `*-CONTEXT.md` stage
contract and drives ONE pipeline stage (research | plan | design | implement | validate)
autonomously. It launches **detached and non-blocking** (rule 4 binary resolution, rule 3 env
scrub, rule 2 stdin=DEVNULL) and returns the heartbeat path to poll
(`.prism/local/<stage>-progress.txt`) — author in Cowork cloud, execute device-side. The contract
shape it consumes is `.prism/shared/ref/icm-run-contract.md`; the blank is
`.prism/shared/plans/_TEMPLATE-stage-CONTEXT.md`.
