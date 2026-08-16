import { Command } from 'commander';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { runInit } from './commands/init.js';
import { runAdd } from './commands/add.js';
import { runConnect } from './commands/connect.js';
import { runEmit } from './commands/emit.js';
import { getGitAuthorName } from './utils/git.js';
import { TARGET_IDS } from './engine/adapters/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

const program = new Command();

program
  .name('create-fragment')
  .description('Scaffold multi-surface AI applications with pre-wired agent connections')
  .version('4.5.0');

program
  .command('init <name>')
  .description('Create a new Fragment project')
  .option('--electron', 'Include Electron desktop app')
  .option('--vscode', 'Include VS Code extension')
  .option('--tui', 'Include Go Bubble Tea TUI')
  .option('--mobile', 'Include Expo/EAS mobile app')
  .option('--mcp', 'Include a local stdio MCP server (Python + TS, no-orphan stdio hygiene by default)')
  .option('--all', 'Include all surfaces')
  .option('--author <name>', 'Author name (defaults to git config)')
  .action((name: string, opts: Record<string, boolean | string>) => {
    const surfaces: string[] = [];
    if (opts.all) {
      surfaces.push('electron', 'vscode', 'tui', 'mobile', 'mcp');
    } else {
      if (opts.electron) surfaces.push('electron');
      if (opts.vscode) surfaces.push('vscode');
      if (opts.tui) surfaces.push('tui');
      if (opts.mobile) surfaces.push('mobile');
      if (opts.mcp) surfaces.push('mcp');
    }

    if (surfaces.length === 0) {
      console.error('Error: specify at least one surface (--electron, --vscode, --tui, --mobile, or --all)');
      process.exit(1);
    }

    const authorName = (opts.author as string) || getGitAuthorName();
    const outputDir = resolve(process.cwd(), name);

    runInit({
      name,
      outputDir,
      templatesDir: TEMPLATES_DIR,
      surfaces,
      authorName,
    });
  });

program
  .command('add')
  .description('Add a surface to an existing Fragment project')
  .option('--electron', 'Add Electron desktop app')
  .option('--vscode', 'Add VS Code extension')
  .option('--tui', 'Add Go Bubble Tea TUI')
  .option('--mobile', 'Add Expo/EAS mobile app')
  .option('--mcp', 'Add a local stdio MCP server (Python + TS, hygiene by default)')
  .action((opts: Record<string, boolean>) => {
    const surface = opts.electron ? 'electron' : opts.vscode ? 'vscode' : opts.tui ? 'tui' : opts.mobile ? 'mobile' : opts.mcp ? 'mcp' : null;

    if (!surface) {
      console.error('Error: specify a surface to add (--electron, --vscode, --tui, --mobile, or --mcp)');
      process.exit(1);
    }

    runAdd({
      projectDir: process.cwd(),
      templatesDir: TEMPLATES_DIR,
      surface: surface as string,
    });
  });

program
  .command('connect')
  .description('Wire an AI plugin into existing Fragment surfaces')
  .action(() => {
    runConnect({
      projectDir: process.cwd(),
    });
  });

program
  .command('emit <skillDir>')
  .description('Compile a Fragment skill to a target package via the multi-target adapter compiler')
  .requiredOption('--target <id>', `Target platform (${TARGET_IDS.join(' | ')})`)
  .option('--out <dir>', 'Output directory (default: ./emit/<target>)')
  .option('--mcp-url <url>', 'Hosted MCP server URL for tool-backed targets')
  .option('--tools <file>', 'Path to a normalized tools.json to attach to the IR')
  .action((skillDir: string, opts: Record<string, string>) => {
    runEmit({
      skillDir: resolve(process.cwd(), skillDir),
      target: opts.target,
      outDir: opts.out ? resolve(process.cwd(), opts.out) : resolve(process.cwd(), 'emit', opts.target),
      mcpUrl: opts.mcpUrl,
      toolsFile: opts.tools ? resolve(process.cwd(), opts.tools) : undefined,
    });
  });

program.parse();
