import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ChannelConfig {
  server: string;
  /**
   * Channel transport axis (cl-plugin-structure -> channel-patterns.md -> "Transport Modes").
   * 'bus' = passive filesystem bus (capabilities:{tools:{}}; $SCREEN_DIR cards out, $STATE_DIR/events
   * JSONL in) -- headless- and Cowork-cloud-safe, the DEFAULT. 'push' = live-push
   * (experimental["claude/channel"]) -- interactive-only, inert headless. Absent => treat as 'bus'.
   */
  transport?: 'bus' | 'push';
}

export interface PluginInfo {
  name: string;
  version?: string;
  description?: string;
  mcpServers: Record<string, McpServerConfig>;
  channels: ChannelConfig[];
  userConfig: Record<string, unknown>;
  hooks: Record<string, unknown>;
  skills: string[];
  pluginDir: string;
}

export function discoverPlugin(projectDir: string): PluginInfo | null {
  // Prefer a COLOCATED AI plugin to wire (plugins/*/.claude-plugin/plugin.json)
  // over the project's OWN root manifest. The root .claude-plugin is the
  // scaffolded project's identity (its Prism-image skills, no MCP servers to
  // wire); a colocated plugin is the one `fragment connect` actually wires in.
  const pluginsDir = join(projectDir, 'plugins');
  if (existsSync(pluginsDir)) {
    for (const entry of readdirSync(pluginsDir)) {
      const manifest = join(pluginsDir, entry, '.claude-plugin', 'plugin.json');
      if (existsSync(manifest)) {
        return parsePluginManifest(manifest, join(pluginsDir, entry));
      }
    }
  }

  // Fall back to the project's own root manifest.
  const rootManifest = join(projectDir, '.claude-plugin', 'plugin.json');
  if (existsSync(rootManifest)) {
    return parsePluginManifest(rootManifest, projectDir);
  }

  return null;
}

function parsePluginManifest(manifestPath: string, pluginDir: string): PluginInfo {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  return {
    name: raw.name,
    version: raw.version,
    description: raw.description,
    mcpServers: raw.mcpServers || {},
    // Bus-first default: a channel with no declared transport is a passive bus (headless-safe).
    channels: (raw.channels || []).map((c: ChannelConfig) => ({ transport: 'bus' as const, ...c })),
    userConfig: raw.userConfig || {},
    hooks: raw.hooks || {},
    skills: raw.skills || [],
    pluginDir,
  };
}

export function detectSurfaces(projectDir: string): string[] {
  const appsDir = join(projectDir, 'apps');
  if (!existsSync(appsDir)) return [];

  const surfaces: string[] = [];
  for (const surface of ['electron', 'vscode', 'tui', 'mobile']) {
    if (existsSync(join(appsDir, surface))) {
      surfaces.push(surface);
    }
  }
  return surfaces;
}
