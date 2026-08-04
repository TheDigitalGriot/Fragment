"""Passive-bus channel transport for a local stdio MCP server (the DEFAULT transport).

Two transports exist on the channel primitive (cl-plugin-structure ->
references/channel-patterns.md -> "Transport Modes -- Live-Push vs Passive Bus"):

  * PASSIVE BUS (this module, bus-first + load-bearing) -- the server declares only
    `capabilities: { tools: {} }` and moves events through the FILESYSTEM:
        OUT  option cards written as HTML to a per-session $SCREEN_DIR the cockpit renders
        IN   rulings/events read as JSONL from $STATE_DIR/events
    Nothing depends on a live notification listener, so the SAME server runs unchanged in
    an interactive terminal, in Cowork cloud, and under headless `claude -p`. Build here
    first; never gate a skill's correctness on anything but the bus.

  * LIVE-PUSH (opt-in, interactive-only) -- `experimental["claude/channel"]` + the
    `notifications/claude/channel` method. Needs a live consumer attached to the session;
    inert headless (no consumer -> the push has nowhere to land). Layer it on ONLY for
    interactive surfaces (phone-relay, real-time wake) as an accelerator, never as the
    load-bearing path. See the commented opt-in block in server.py.

Reference server: prism scripts/digital-griot-mcp/digital-griot-mcp.ts
(`capabilities:{tools:{}}`, `$STATE_DIR/events`, HTML cards to `$SCREEN_DIR`).
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path


def _bus_root() -> Path:
    """Base dir under which per-session dirs live; override with $GRIOT_BUS_ROOT."""
    root = os.environ.get("GRIOT_BUS_ROOT")
    if root:
        return Path(root)
    return Path(tempfile.gettempdir()) / "{{PROJECT_NAME}}-bus"


def _newest_session_dir(base: Path) -> Path | None:
    if not base.is_dir():
        return None
    dirs = [d for d in base.iterdir() if d.is_dir()]
    if not dirs:
        return None
    return max(dirs, key=lambda d: d.stat().st_mtime)


def resolve_state_dir(explicit: str | None = None) -> Path:
    """STATE_DIR precedence (channel-patterns.md): explicit arg -> $STATE_DIR env ->
    newest session dir -> fallback. The fallback is created so reads/writes never crash."""
    if explicit:
        return Path(explicit)
    env = os.environ.get("STATE_DIR")
    if env:
        return Path(env)
    newest = _newest_session_dir(_bus_root())
    if newest:
        return newest
    fallback = _bus_root() / "default"
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


def resolve_screen_dir(explicit: str | None = None) -> Path:
    """SCREEN_DIR precedence mirrors STATE_DIR: explicit -> $SCREEN_DIR -> <state_dir>/screen."""
    if explicit:
        return Path(explicit)
    env = os.environ.get("SCREEN_DIR")
    if env:
        return Path(env)
    return resolve_state_dir() / "screen"


def read_events(state_dir: str | None = None, *, since: int = 0) -> list[dict]:
    """IN half -- read $STATE_DIR/events as JSONL, returning parsed records from line `since`
    on. A malformed / partially-written tail line is skipped, never raised, so a reader that
    races the writer is safe. Returns [] when no events file exists yet."""
    path = resolve_state_dir(state_dir) / "events"
    if not path.is_file():
        return []
    out: list[dict] = []
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines()):
        if i < since:
            continue
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def write_card(html: str, *, name: str = "card", screen_dir: str | None = None) -> Path:
    """OUT half -- write an option card as HTML to $SCREEN_DIR the cockpit renders. Written
    temp-then-replace so a reader never observes a half-written card. Returns the path."""
    sdir = resolve_screen_dir(screen_dir)
    sdir.mkdir(parents=True, exist_ok=True)
    dest = sdir / f"{name}.html"
    tmp = sdir / f".{name}.html.tmp"
    tmp.write_text(html, encoding="utf-8")
    tmp.replace(dest)
    return dest
