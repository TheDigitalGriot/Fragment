"""Example local stdio MCP server for {{PROJECT_NAME}}, wired with no-orphan stdio hygiene AND
the bus-first channel transport by default. Replace the example tools with your real ones --
keep the hygiene helpers and, if this server is a channel, keep the passive-bus tools.

stdout is owned by the MCP stdio transport for JSON-RPC (rule 1). Do NOT print() to stdout
anywhere in this process; use `_hygiene.log()` (stderr) for diagnostics.

Channel transport (cl-plugin-structure -> references/channel-patterns.md -> "Transport Modes"):
this server is a PASSIVE BUS -- `capabilities: { tools: {} }` (no push capability) + filesystem
I/O via `channel_bus`. It therefore runs unchanged in a terminal, in Cowork cloud, and under
headless `claude -p`. Live-push is an OPT-IN interactive accelerator only -- see the commented
block below; never make a skill's correctness depend on a pushed reply arriving.
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

from _hygiene import find_binary, log, run_child, sanitized_env
from channel_bus import read_events, write_card

# Passive-bus channel server: the tools:{} floor is the load-bearing transport. `Server` declares
# tool capability by default -- do NOT add `experimental["claude/channel"]` here unless you are
# deliberately layering live-push on an interactive-only surface (and even then the bus stays the
# source of truth). See the opt-in note at the bottom of this file.
server = Server("{{PROJECT_NAME}}-mcp")


@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="run_command",
            description="Run a helper binary with full stdio hygiene and return its stdout.",
            inputSchema={
                "type": "object",
                "properties": {
                    "args": {"type": "array", "items": {"type": "string"}}
                },
                "required": ["args"],
            },
        ),
        # -- ICM stage-walk launcher (Prism-image; cloud-author -> device-execute) -----------
        Tool(
            name="icm_prism_run",
            description=(
                "Launch a Prism ICM stage-walk headless: spawn `claude -p` with a THIN router "
                "prompt that reads a *-CONTEXT.md stage contract and executes ONE pipeline stage "
                "(research|plan|design|implement|validate) autonomously. Detached and non-blocking "
                "-- returns the heartbeat path to poll (.prism/local/<stage>-progress.txt). Author "
                "in Cowork cloud, execute device-side. Shape: .prism/shared/ref/icm-run-contract.md."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "stage": {
                        "type": "string",
                        "description": "Pipeline stage to drive: research | plan | design | implement | validate.",
                    },
                    "contract_path": {
                        "type": "string",
                        "description": "Path to the *-CONTEXT.md stage contract (Working/Reference/Locked Decisions).",
                    },
                    "cwd": {
                        "type": "string",
                        "description": "Repo working dir for the headless run (default: cwd).",
                    },
                },
                "required": ["stage", "contract_path"],
            },
        ),
        # -- Passive-bus channel tools (headless- and Cowork-cloud-safe) ---------------------
        Tool(
            name="read_events",
            description=(
                "Passive-bus IN: read this session's $STATE_DIR/events JSONL "
                "(rulings/events the cockpit appended). Safe headless and in Cowork cloud."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "state_dir": {
                        "type": "string",
                        "description": "Explicit STATE_DIR; omit to auto-resolve (env -> newest session -> fallback).",
                    },
                    "since": {
                        "type": "integer",
                        "description": "Skip the first N JSONL lines (a simple read cursor).",
                    },
                },
            },
        ),
        Tool(
            name="present_card",
            description=(
                "Passive-bus OUT: write an option card as HTML to this session's $SCREEN_DIR "
                "the cockpit renders. Use this instead of AskUserQuestion when running headless."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "html": {"type": "string", "description": "Card HTML to render."},
                    "name": {"type": "string", "description": "Card file stem (default 'card')."},
                    "screen_dir": {"type": "string", "description": "Explicit SCREEN_DIR; omit to auto-resolve."},
                },
                "required": ["html"],
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    if name == "run_command":
        args = arguments["args"]
        # rule 4: resolve the binary interpreter-first (bundled/venv before PATH)
        binary = find_binary(args[0])
        # rules 1,2,3: stdin=DEVNULL, stdout captured (not leaked to the server's stdout), env sanitized
        proc = await asyncio.to_thread(run_child, [binary, *args[1:]], timeout=30)
        if proc.returncode != 0:
            log(f"run_command: {args[0]} exited {proc.returncode}: {proc.stderr[:200]}")
        # child stdout returned as a structured tool RESULT -- never printed to stdout (rule 1)
        return [TextContent(type="text", text=proc.stdout)]
    if name == "icm_prism_run":
        stage = arguments["stage"]
        contract_path = arguments["contract_path"]
        cwd = arguments.get("cwd", os.getcwd())
        # Thin router prompt -- the contract carries the detail; a headless run cannot ask questions.
        prompt = (
            f"Run the {stage} stage. Read the stage contract at {contract_path} and execute it "
            f"exactly. Load only what each step needs via the discovery agents "
            f"(graph-navigator/codebase-analyzer/codebase-locator/prism-locator). Proceed "
            f"autonomously; do not ask questions. Heartbeat one token line per step to "
            f".prism/local/{stage}-progress.txt."
        )
        # rule 4: resolve claude interpreter-first. Detached so the server is NOT blocked (B13
        # detached-poll launcher); the caller polls the heartbeat file instead of awaiting stdout.
        claude = find_binary("claude")
        proc = subprocess.Popen(
            [claude, "-p", prompt, "--agent", "claude"],
            cwd=cwd,
            stdin=subprocess.DEVNULL,  # rule 2
            stdout=subprocess.DEVNULL,  # rule 1: no child output on our JSON-RPC stdout
            stderr=subprocess.DEVNULL,
            env=sanitized_env(),  # rule 3
        )
        heartbeat = f".prism/local/{stage}-progress.txt"
        return [
            TextContent(
                type="text",
                text=f"icm_prism_run launched (pid {proc.pid}) in {cwd}; poll {heartbeat}",
            )
        ]
    if name == "read_events":
        events = read_events(arguments.get("state_dir"), since=int(arguments.get("since", 0)))
        return [TextContent(type="text", text=json.dumps(events))]
    if name == "present_card":
        dest = write_card(
            arguments["html"],
            name=arguments.get("name", "card"),
            screen_dir=arguments.get("screen_dir"),
        )
        return [TextContent(type="text", text=f"card written: {dest}")]
    raise ValueError(f"unknown tool: {name}")


async def main() -> None:
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())


# --- OPT-IN: live-push (interactive surfaces only) --------------------------------------------
# The passive bus above is the load-bearing transport and runs everywhere. If (and only if) this
# channel targets an INTERACTIVE surface that benefits from real-time wake / phone-relay, you may
# ADD live-push on top -- it is inert headless, so it must never be the path correctness depends on.
# To opt in: construct the server with the experimental capability and push events:
#
#     server = Server(
#         "{{PROJECT_NAME}}-mcp",
#         # capabilities merged by the SDK; declares the notification listener + tools floor
#     )
#     # ... then, when an external event arrives on an interactive session:
#     # await server.request_context.session.send_notification(
#     #     "notifications/claude/channel",
#     #     {"content": "build failed on main", "meta": {"severity": "high"}},
#     # )
#
# Keep the bus tools regardless -- push accelerates the interactive case; the bus keeps the same
# server correct headless and in Cowork cloud.
