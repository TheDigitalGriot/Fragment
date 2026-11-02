/**
 * Gemini Skills adapter (the Gemini app's "Upload a skill" flow). INSTALLABLE.
 *
 * Distinct from gemini-gems (guidance only, kept unchanged for Workspace accounts that still use
 * Gems). Gemini Skills accept an uploaded folder, so this target emits a real upload folder:
 *
 *   <outDir>/skills/<name>/          the folder to upload (SKILL.md at its top level)
 *   <outDir>/upload-manifest.json    what was included / skipped, a SIBLING of skills/ so it is
 *                                    never uploaded by accident
 *
 * Upload rules (from the Gemini app's Upload a skill dialog, 2026-11-01):
 *   - the skill name in SKILL.md frontmatter is kebab-case
 *   - SKILL.md sits in the main folder of the upload
 *   - accepted file types: PDF, CSV, PY, TXT, MD, plus images
 *   Upload: Customize > Skills > Create > Upload. Update: open the skill > More > Replace skill.
 *
 * Every other file type (yaml, json, mjs, ts, ...) is skipped and listed in the manifest. A name
 * that is not kebab-case, or that differs from its source folder name, fails the emit loudly.
 * The Claude/Cowork-only Resources section is replaced by a generated "How the other surfaces run
 * this" section (Amendment A1: D4 approved, D9), derived from the IR and the skill's surfaces table.
 */
import { basename, extname } from 'path';
import type { SkillIR } from './ir.js';
import { knowledgeBytes } from './ir.js';
import type { Adapter, EmitOptions } from './types.js';
import { renderSkillMarkdown } from './skill-folder.js';
import { writeUnder } from './types.js';

/** Text types the Gemini upload dialog accepts. */
export const GEMINI_TEXT_EXTENSIONS = ['.md', '.txt', '.py', '.csv'];
/** Binary types the Gemini upload dialog accepts (PDF plus images). */
export const GEMINI_BINARY_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp'];
export const GEMINI_ACCEPTED_EXTENSIONS = [...GEMINI_TEXT_EXTENSIONS, ...GEMINI_BINARY_EXTENSIONS];

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Claude/Cowork-only section: it routes bundled files through PLUGIN_ROOT and the device bridge,
 * which do not exist in Gemini. Matches the hyphen, colon and legacy em-dash heading variants.
 */
const RESOURCES_HEADING = /^##\s+Resources\s*(?:-|:|\u2014)\s*cloud \/ device resolution/;
const SECTION_END = /^#{1,2}\s/;

/** True when Gemini's upload dialog accepts this file path. */
export function isGeminiAccepted(path: string): boolean {
  return GEMINI_ACCEPTED_EXTENSIONS.includes(extname(path).toLowerCase());
}

/**
 * Drop the "Resources - cloud / device resolution" section (heading up to the next # or ## heading)
 * and put `replacement` in its place. With no Resources section, `replacement` goes after the first
 * H1 (or at the top). Returns the new body and whether a section was removed. The source SKILL.md
 * is untouched.
 */
export function dropResourcesSection(body: string, replacement = ''): { body: string; dropped: boolean } {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const insert = replacement ? ['', ...replacement.trim().split('\n'), ''] : [];
  const start = lines.findIndex((l) => RESOURCES_HEADING.test(l));
  let out: string[];
  if (start === -1) {
    if (!replacement) return { body, dropped: false };
    const h1 = lines.findIndex((l) => /^#\s/.test(l));
    out = [...lines.slice(0, h1 + 1), ...insert, ...lines.slice(h1 + 1)];
  } else {
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (SECTION_END.test(lines[i])) {
        end = i;
        break;
      }
    }
    out = [...lines.slice(0, start), ...insert, ...lines.slice(end)];
  }
  return { body: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), dropped: start !== -1 };
}

/** One row of a skill's surfaces table (references/surfaces.md), matched by header name. */
export interface SurfaceRow {
  surface: string;
  generate: string;
  edit: string;
  mode: string;
}

function tableCells(line: string): string[] | null {
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  return t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/**
 * Parse the first markdown table whose header carries Surface and Mode columns. Columns are found
 * by header name (Surface, Generate, Edit..., Mode), never by position. No such table => [].
 */
export function parseSurfacesTable(md: string): SurfaceRow[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const head = tableCells(lines[i]);
    if (!head) continue;
    const col = (re: RegExp) => head.findIndex((h) => re.test(h));
    const s = col(/^surface$/i);
    const g = col(/^generate$/i);
    const e = col(/^edit\b/i);
    const m = col(/^mode$/i);
    if (s < 0 || m < 0 || !/^\|?\s*:?-{3,}/.test(lines[i + 1].trim())) continue;
    const rows: SurfaceRow[] = [];
    for (let j = i + 2; j < lines.length; j++) {
      const c = tableCells(lines[j]);
      if (!c) break;
      rows.push({
        surface: c[s] ?? '',
        generate: g >= 0 ? (c[g] ?? '') : '',
        edit: e >= 0 ? (c[e] ?? '') : '',
        mode: c[m] ?? '',
      });
    }
    return rows;
  }
  return [];
}

const firstWord = (s: string) => s.trim().split(/[\s(,;]/)[0];
const parenthetical = (s: string) => (s.match(/\(([^)]*)\)/) ?? [])[1]?.trim();
const joinList = (xs: string[]) =>
  xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/**
 * Render "## How the other surfaces run this": a short template fed by the IR. Bundle facts come
 * from the IR's knowledge files; modes, models and attach methods come from the skill's own
 * surfaces table (a `surfaces.md` knowledge file) when it has one. Codex's agents/openai.yaml is
 * Fragment's own chatgpt-skills output. Never more than 12 lines; never an em dash.
 */
export function renderOtherSurfaces(ir: SkillIR): string {
  const scripts = ir.knowledgeFiles.filter((k) => k.role === 'script').map((k) => `\`${k.path}\``);
  const hasRefs = ir.knowledgeFiles.some((k) => k.role === 'reference');
  const table = ir.knowledgeFiles.find((k) => /(^|\/)surfaces\.md$/i.test(k.path) && k.encoding !== 'base64');
  const rows = table ? parseSurfacesTable(table.content) : [];
  const row = (re: RegExp) => rows.find((r) => re.test(r.surface));

  const bundle = [...(hasRefs ? ['`references/`'] : []), ...scripts];
  let claude = '- **Claude (Code and Cowork):** ';
  claude += bundle.length ? `bundles ${joinList(bundle)}` : 'runs from SKILL.md alone';
  if (scripts.length) claude += ' and runs the script device-side';
  claude += '.';
  const c = row(/^claude/i);
  if (c) claude += ` Works in ${firstWord(c.mode)} mode${/^no\b/i.test(c.generate) ? ' because Claude cannot generate images' : ''}.`;

  let codex = '- **Codex:** installs the skill with `agents/openai.yaml`.';
  const x = row(/^codex/i);
  if (x) {
    const via = x.mode.match(/\bvia\s+(.+)$/i)?.[1];
    codex += ` Works in ${firstWord(x.mode)} mode${via ? `, generating with ${via}` : ''}.`;
    const attach = parenthetical(x.edit);
    if (attach) codex += ` Attaches refs with ${attach}.`;
  }

  let gemini = '- **Gemini app (this build):**';
  const gm = row(/^gemini app/i);
  if (gm) {
    const model = parenthetical(gm.surface);
    gemini += ` works in ${firstWord(gm.mode)} mode${model ? ` with ${model}` : ''}.`;
  }
  gemini += scripts.length
    ? ` It cannot run ${joinList(scripts)}, so it gives the user the manifest that script would act on as a table.`
    : ' runs from this SKILL.md and the uploaded files.';

  return [
    '## How the other surfaces run this',
    '',
    `This is the Gemini app build of ${ir.name}. The sibling builds come from the same source:`,
    claude,
    codex,
    gemini,
  ]
    .join('\n')
    .replace(/\u2014/g, '-');
}

/** Throw unless the skill name is kebab-case and (when known) equals its source folder name. */
export function assertGeminiName(ir: SkillIR, sourceDir?: string): void {
  if (!KEBAB_CASE.test(ir.name)) {
    throw new Error(
      `gemini-skills: skill name "${ir.name}" is not kebab-case. Gemini's upload requires a kebab-case ` +
        `name in SKILL.md frontmatter (lowercase letters, digits, single hyphens).`,
    );
  }
  if (sourceDir) {
    const folder = basename(sourceDir.replace(/[\\/]+$/, ''));
    if (folder !== ir.name) {
      throw new Error(
        `gemini-skills: frontmatter name "${ir.name}" does not match its folder name "${folder}". ` +
          `Rename one so they agree before uploading.`,
      );
    }
  }
}

export const geminiSkillsAdapter: Adapter = {
  id: 'gemini-skills',
  label: 'Gemini Skills (upload folder)',
  installable: true,
  emit(ir: SkillIR, outDir: string, opts: EmitOptions = {}): string[] {
    assertGeminiName(ir, opts.sourceDir);

    const root = `skills/${ir.name}`;
    // D4 (approved) + D9: the Claude/Cowork-only Resources section is replaced by a generated
    // summary of how the sibling builds run, so Gemini knows what Claude and Codex do differently.
    const { body, dropped } = dropResourcesSection(ir.instructions, renderOtherSurfaces(ir));
    const written: string[] = [];
    written.push(writeUnder(outDir, `${root}/SKILL.md`, renderSkillMarkdown({ ...ir, instructions: body })));

    const included: string[] = ['SKILL.md'];
    const skipped: { path: string; reason: string }[] = [];
    for (const kf of ir.knowledgeFiles) {
      if (isGeminiAccepted(kf.path)) {
        written.push(writeUnder(outDir, `${root}/${kf.path}`, knowledgeBytes(kf)));
        included.push(kf.path);
      } else {
        skipped.push({
          path: kf.path,
          reason: `extension "${extname(kf.path) || '(none)'}" is not an accepted Gemini upload type`,
        });
      }
    }

    const manifest = {
      target: 'gemini-skills',
      skill: ir.name,
      uploadFolder: root,
      acceptedExtensions: GEMINI_ACCEPTED_EXTENSIONS,
      included,
      skipped,
      droppedSections: dropped ? ['Resources - cloud / device resolution (Claude/Cowork only)'] : [],
      addedSections: ['How the other surfaces run this'],
      upload: 'Gemini app: Customize > Skills > Create > Upload, then choose the uploadFolder.',
      update: 'Gemini app: open the skill > More > Replace skill, then choose the uploadFolder.',
    };
    written.push(writeUnder(outDir, 'upload-manifest.json', JSON.stringify(manifest, null, 2) + '\n'));
    return written;
  },
};
