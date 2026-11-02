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
const RESOURCES_HEADING = /^##\s+Resources\s*(?:-|:|—)\s*cloud \/ device resolution/;
const SECTION_END = /^#{1,2}\s/;

/** True when Gemini's upload dialog accepts this file path. */
export function isGeminiAccepted(path: string): boolean {
  return GEMINI_ACCEPTED_EXTENSIONS.includes(extname(path).toLowerCase());
}

/**
 * Drop the "Resources - cloud / device resolution" section (heading up to the next # or ## heading).
 * Returns the stripped body and whether a section was removed. The source SKILL.md is untouched.
 */
export function dropResourcesSection(body: string): { body: string; dropped: boolean } {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => RESOURCES_HEADING.test(l));
  if (start === -1) return { body, dropped: false };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (SECTION_END.test(lines[i])) {
      end = i;
      break;
    }
  }
  const kept = [...lines.slice(0, start), ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n');
  return { body: kept.trim(), dropped: true };
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
    const { body, dropped } = dropResourcesSection(ir.instructions);
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
      upload: 'Gemini app: Customize > Skills > Create > Upload, then choose the uploadFolder.',
      update: 'Gemini app: open the skill > More > Replace skill, then choose the uploadFolder.',
    };
    written.push(writeUnder(outDir, 'upload-manifest.json', JSON.stringify(manifest, null, 2) + '\n'));
    return written;
  },
};
