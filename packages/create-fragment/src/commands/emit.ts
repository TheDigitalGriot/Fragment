/**
 * `create-fragment emit` — build an IR from a Fragment skill folder and lower it to one target.
 */
import { readFileSync, existsSync } from 'fs';
import { buildIRFromSkill, emitTarget, type NormalizedTool } from '../engine/adapters/index.js';

export interface EmitCommandOptions {
  skillDir: string;
  target: string;
  outDir: string;
  mcpUrl?: string;
  toolsFile?: string;
}

export function runEmit(options: EmitCommandOptions): void {
  const { skillDir, target, outDir, mcpUrl, toolsFile } = options;

  let tools: NormalizedTool[] | undefined;
  if (toolsFile) {
    if (!existsSync(toolsFile)) {
      console.error(`Error: tools file not found: ${toolsFile}`);
      process.exit(1);
    }
    tools = JSON.parse(readFileSync(toolsFile, 'utf-8')) as NormalizedTool[];
  }

  const ir = buildIRFromSkill(skillDir, tools ? { tools } : {});
  const written = emitTarget(target, ir, outDir, { mcpUrl });

  console.log(`Emitted ${target} package for "${ir.name}" -> ${outDir}`);
  for (const f of written) console.log(`  + ${f}`);
}
