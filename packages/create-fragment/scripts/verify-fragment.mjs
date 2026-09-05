#!/usr/bin/env node
/**
 * verify-fragment.mjs — run Fragment's scaffold invariants as checks.
 *
 * WHY THIS EXISTS
 * ---------------
 * `fragment init`, `fragment add` and `fragment connect` all printed success
 * unconditionally. `connect` in particular printed "Wired surfaces" with a file
 * list it never verified against disk. A claim nothing checks is a document,
 * not a control. This is the control, and it runs on the path already travelled
 * (the commands invoke it before their success print), so it cannot be
 * forgotten.
 *
 * INVARIANTS
 *   I1  every requested surface is scaffolded AND registered in the workspace
 *       exactly as its own template manifest declares (workspaceEntry), never
 *       a naive apps/<surface> guess.
 *   I2  no template token survives into emitted output — replaceTokens() returns
 *       an unknown {{KEY}} verbatim, so a typo ships silently without this.
 *   I3  a "wired" surface is really wired: (a) each glue file exists on disk,
 *       (b) something outside plugin-glue/ actually imports it, (c) the surface
 *       still builds.
 *
 * HONESTY RULE (mirrors Prism's verify-invariants.mjs and griot_assert): a check
 * that cannot execute reports UNVERIFIED. It never reports a pass it cannot
 * stand behind, and unverified is not failure — it is the absence of evidence,
 * said out loud.
 *
 * USAGE
 *   node scripts/verify-fragment.mjs <projectDir> [--cmd init|add|connect]
 *                                    [--surfaces a,b,c] [--templates <dir>]
 *
 * Exit 0 = no invariant violated.  Exit 1 = at least one FAIL.
 *
 * Pure Node ESM. No dependencies, by design — the gate must run inside a
 * freshly scaffolded project before `npm install` has ever been run.
 */
import {
  readFileSync, existsSync, readdirSync, statSync, mkdirSync, appendFileSync,
} from 'node:fs'
import { join, resolve, relative, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const GATE_DIR = dirname(fileURLToPath(import.meta.url))

// Surfaces that carry generated plugin glue. mcp is EXCLUDED BY DESIGN: it is a
// stdio server, not a UI host, and engine/plugin-discovery.ts detectSurfaces()
// deliberately omits it — there is no mcp-glue generator to verify against.
const GLUE_SURFACES = ['electron', 'vscode', 'tui', 'mobile']
const ALL_SURFACES = [...GLUE_SURFACES, 'mcp']

// Mirrors engine/copier.ts TEXT_EXTENSIONS: only files the copier ran through
// replaceTokens() can carry a surviving token.
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.css', '.html',
  '.yaml', '.yml', '.toml', '.tmpl', '.mod', '.sum', '.go',
  '.mts', '.mjs', '.env',
  '.py', '.cfg', '.ini', '.txt', '.sh',
])
const TEXT_FILENAMES = new Set(['.gitignore', '.env', '.npmrc', '.nvmrc'])

// Per the contract: node_modules/.git/.venv/dist/.expo are never emitted output.
const PRUNE = new Set(['node_modules', '.git', '.venv', 'dist', '.expo'])

const TOKEN_RE = /\{\{\w+\}\}/

// Entry points per surface, most-canonical first. Used to report WHERE the glue
// got imported; a reference from any other non-glue source file also counts.
const ENTRY_POINTS = {
  electron: ['src/main.ts', 'src/preload.ts', 'src/renderer.tsx', 'src/App.tsx'],
  vscode: ['src/extension.ts', 'webview-ui/src/main.tsx', 'webview-panel/src/main.tsx'],
  tui: ['main.go', 'app/model.go', 'app/update.go'],
  mobile: ['index.ts', 'app/_layout.tsx', 'app/(tabs)/_layout.tsx', 'app/(tabs)/index.tsx'],
}

// ── args ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
}
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')))

const PROJECT_DIR = resolve(positional[0] ?? process.cwd())
const CMD = flag('cmd') ?? 'verify'
const REQUESTED = (flag('surfaces') ?? '').split(',').map((s) => s.trim()).filter(Boolean)

// ── small fs helpers ───────────────────────────────────────────────────────
const read = (p) => { try { return readFileSync(p, 'utf-8') } catch { return null } }
const isDir = (p) => { try { return statSync(p).isDirectory() } catch { return false } }
const subdirs = (p) => {
  try { return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) }
  catch { return [] }
}
const isTextFile = (name) =>
  TEXT_EXTENSIONS.has(extname(name)) || TEXT_FILENAMES.has(name)

/** Walk a tree, yielding text files, pruning build/vcs dirs and any skip list. */
function walkText(dir, { skip = [] } = {}, out = []) {
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (PRUNE.has(e.name)) continue
      if (skip.some((s) => resolve(s) === resolve(full))) continue
      walkText(full, { skip }, out)
    } else if (isTextFile(e.name)) {
      out.push(full)
    }
  }
  return out
}

// ── templates dir (the source of workspaceEntry truth) ─────────────────────
function resolveTemplatesDir() {
  const explicit = flag('templates')
  if (explicit && isDir(explicit)) return resolve(explicit)
  // The gate ships INSIDE the package, so the templates sit next to it:
  // <create-fragment>/scripts/ -> <create-fragment>/templates/. This is the
  // published-install layout and is checked FIRST.
  const inPackage = join(GATE_DIR, '..', 'templates')
  if (isDir(inPackage)) return resolve(inPackage)
  // Fallback: invoked from a repo checkout's <repo>/scripts/ shim location.
  const inRepo = join(GATE_DIR, '..', 'packages', 'create-fragment', 'templates')
  if (isDir(inRepo)) return resolve(inRepo)
  return null
}
const TEMPLATES_DIR = resolveTemplatesDir()

/** The ONLY source of workspaceEntry truth. Never guess apps/<surface>. */
function surfaceManifest(surface) {
  if (!TEMPLATES_DIR) return null
  const raw = read(join(TEMPLATES_DIR, surface, 'manifest.json'))
  if (!raw) return null
  try {
    const m = JSON.parse(raw)
    return {
      surface: m.surface ?? surface,
      workspaceEntry: m.workspaceEntry ?? null,
      dependencies: m.dependencies ?? [],
    }
  } catch { return null }
}

// ── heartbeat ──────────────────────────────────────────────────────────────
const hbPath = join(PROJECT_DIR, '.fragment', `${CMD}-progress.txt`)
function hb(token) {
  try {
    mkdirSync(dirname(hbPath), { recursive: true })
    appendFileSync(hbPath, `${new Date().toISOString()} ${token}\n`, 'utf-8')
  } catch { /* heartbeat must never be the thing that fails a run */ }
}

// ── verdicts ───────────────────────────────────────────────────────────────
const results = []
const rec = (id, name, verdict, detail) => {
  results.push({ id, name, verdict, detail })
  hb(`${id}_${verdict.toUpperCase()}`)
}

hb(`START cmd=${CMD} project=${PROJECT_DIR}`)

// ── I1 · requested surfaces scaffolded AND registered per their manifest ───
{
  const onDisk = subdirs(join(PROJECT_DIR, 'apps')).filter((d) => ALL_SURFACES.includes(d))
  const requested = REQUESTED.length ? REQUESTED : onDisk

  if (!requested.length) {
    rec('I1', 'surfaces scaffolded + workspace-registered', 'unverified',
        'no surfaces requested and none found under apps/')
  } else {
    const rootPkgRaw = read(join(PROJECT_DIR, 'package.json'))
    let workspaces = null
    try { workspaces = Array.isArray(JSON.parse(rootPkgRaw).workspaces) ? JSON.parse(rootPkgRaw).workspaces : [] }
    catch { workspaces = null }

    const problems = []
    const unknowns = []
    const proofs = []
    let needsShared = false

    for (const s of requested) {
      // (a) the surface was actually emitted
      if (!isDir(join(PROJECT_DIR, 'apps', s))) {
        problems.push(`${s}: apps/${s} missing`)
        continue
      }

      const m = surfaceManifest(s)
      if (!m) {
        unknowns.push(`${s}: no templates/${s}/manifest.json readable — workspaceEntry unknown`)
        continue
      }
      if ((m.dependencies ?? []).some((d) => d === 'core' || d === 'ui')) needsShared = true

      // (b) manifest-declared workspace entry — the exact declared path, never a guess
      if (m.workspaceEntry === null) {
        proofs.push(`${s}: workspaceEntry null (no npm workspace expected)`)
        continue
      }
      if (!existsSync(join(PROJECT_DIR, m.workspaceEntry))) {
        problems.push(`${s}: declared workspaceEntry "${m.workspaceEntry}" does not exist on disk`)
        continue
      }
      if (workspaces === null) {
        unknowns.push(`${s}: root package.json unreadable — cannot confirm "${m.workspaceEntry}"`)
        continue
      }
      if (!workspaces.includes(m.workspaceEntry)) {
        problems.push(`${s}: "${m.workspaceEntry}" not in root package.json workspaces`)
        continue
      }
      proofs.push(`${s}->${m.workspaceEntry}`)
    }

    // (c) shared packages exist when any requested surface depends on them
    if (needsShared) {
      for (const p of ['packages/core', 'packages/ui']) {
        if (!isDir(join(PROJECT_DIR, p))) problems.push(`${p} missing (a requested surface depends on it)`)
      }
    }

    if (problems.length) {
      rec('I1', 'surfaces scaffolded + workspace-registered', 'fail',
          problems.slice(0, 4).join(' · ') + (problems.length > 4 ? ` (+${problems.length - 4})` : ''))
    } else if (unknowns.length) {
      rec('I1', 'surfaces scaffolded + workspace-registered', 'unverified', unknowns.join(' · '))
    } else {
      rec('I1', 'surfaces scaffolded + workspace-registered', 'pass',
          `${requested.length} surface(s): ${proofs.join(', ')}`)
    }
  }
}

// ── I2 · no template token survives into emitted output ────────────────────
{
  const files = walkText(PROJECT_DIR)
  if (!files.length) {
    rec('I2', 'no surviving {{TOKEN}} in emitted files', 'unverified',
        `no emitted text files found under ${PROJECT_DIR}`)
  } else {
    const survivors = []
    for (const f of files) {
      const t = read(f)
      if (t === null) continue
      const m = t.match(new RegExp(TOKEN_RE.source, 'g'))
      if (m) survivors.push(`${relative(PROJECT_DIR, f).replace(/\\/g, '/')} [${[...new Set(m)].join(' ')}]`)
    }
    if (survivors.length) {
      rec('I2', 'no surviving {{TOKEN}} in emitted files', 'fail',
          survivors.slice(0, 4).join(' · ') + (survivors.length > 4 ? ` (+${survivors.length - 4} more)` : ''))
    } else {
      rec('I2', 'no surviving {{TOKEN}} in emitted files', 'pass', `${files.length} text file(s) scanned, 0 survivors`)
    }
  }
}

// ── glue inventory (shared by I3a/I3b/I3c) ─────────────────────────────────
/**
 * What did `fragment connect` claim it wired? runConnect writes its ConnectResult
 * to .fragment/connect-result.json before the gate runs, so the gate checks the
 * ACTUAL returned list rather than re-deriving it. Standalone runs fall back to
 * on-disk discovery so the gate is still useful without that file.
 */
function glueInventory() {
  const claimed = read(join(PROJECT_DIR, '.fragment', 'connect-result.json'))
  if (claimed) {
    try {
      const parsed = JSON.parse(claimed)
      const out = []
      for (const [surface, files] of Object.entries(parsed.files ?? {})) {
        if (!GLUE_SURFACES.includes(surface)) continue   // mcp is never glue-wired
        for (const f of files) out.push({ surface, rel: String(f).replace(/\\/g, '/'), source: 'connect-result' })
      }
      return out
    } catch { /* fall through to disk discovery */ }
  }
  const out = []
  for (const surface of GLUE_SURFACES) {
    const surfaceDir = join(PROJECT_DIR, 'apps', surface)
    if (!isDir(surfaceDir)) continue
    for (const glueDir of [join(surfaceDir, 'src', 'plugin-glue'), join(surfaceDir, 'plugin-glue')]) {
      if (!isDir(glueDir)) continue
      for (const f of walkText(glueDir)) {
        out.push({ surface, rel: relative(surfaceDir, f).replace(/\\/g, '/'), source: 'disk' })
      }
    }
  }
  return out
}

const GLUE = glueInventory()
const GLUE_SURFACES_PRESENT = [...new Set(GLUE.map((g) => g.surface))]

// ── I3a · every claimed glue file exists on disk ───────────────────────────
{
  if (!GLUE.length) {
    rec('I3a', 'glue files exist on disk', 'unverified',
        'no plugin glue emitted — `fragment connect` has not run for this project')
  } else {
    const missing = GLUE.filter((g) => !existsSync(join(PROJECT_DIR, 'apps', g.surface, g.rel)))
    if (missing.length) {
      rec('I3a', 'glue files exist on disk', 'fail',
          missing.map((g) => `apps/${g.surface}/${g.rel}`).slice(0, 4).join(' · '))
    } else {
      rec('I3a', 'glue files exist on disk', 'pass',
          `${GLUE.length} file(s) across ${GLUE_SURFACES_PRESENT.join(', ')} (via ${GLUE[0].source})`)
    }
  }
}

// ── I3b · the glue is actually imported by the surface ─────────────────────
{
  if (!GLUE.length) {
    rec('I3b', 'glue imported by surface entry point', 'unverified', 'no plugin glue to check')
  } else {
    const unwired = []
    const wired = []
    for (const g of GLUE) {
      const surfaceDir = join(PROJECT_DIR, 'apps', g.surface)
      const abs = join(surfaceDir, g.rel)
      if (!existsSync(abs)) continue                        // already reported by I3a
      const glueDir = dirname(abs)

      // Needles: the module specifier as it would be written in an import, plus
      // the Go package name for .go glue (Go imports the package, not the file).
      const noExt = g.rel.replace(/\.[^./]+$/, '')
      const needles = [noExt, noExt.split('/').slice(-2).join('/')]
      if (g.rel.endsWith('.go')) needles.push('pluginglue', 'plugin-glue')

      // Prefer a canonical entry point, then any non-glue source file.
      const candidates = [
        ...(ENTRY_POINTS[g.surface] ?? []).map((p) => join(surfaceDir, p)).filter((p) => existsSync(p)),
        ...walkText(surfaceDir, { skip: [glueDir] }),
      ]
      const hit = candidates.find((c) => {
        if (resolve(c) === resolve(abs)) return false
        if (resolve(dirname(c)) === resolve(glueDir)) return false   // glue importing glue is not wiring
        const t = read(c)
        return t !== null && needles.some((n) => t.includes(n))
      })

      if (hit) wired.push(`${g.surface}/${g.rel} <- ${relative(surfaceDir, hit).replace(/\\/g, '/')}`)
      else unwired.push(`apps/${g.surface}/${g.rel} imported by nothing`)
    }

    if (unwired.length) {
      rec('I3b', 'glue imported by surface entry point', 'fail',
          unwired.slice(0, 4).join(' · ') + (unwired.length > 4 ? ` (+${unwired.length - 4})` : ''))
    } else {
      rec('I3b', 'glue imported by surface entry point', 'pass', wired.slice(0, 3).join(' · '))
    }
  }
}

// ── I3c · the wired surface still builds ───────────────────────────────────
{
  if (!GLUE.length) {
    rec('I3c', 'wired surface builds', 'unverified', 'no plugin glue to build')
  } else {
    const fails = []
    const passes = []
    const skips = []

    for (const surface of GLUE_SURFACES_PRESENT) {
      const surfaceDir = join(PROJECT_DIR, 'apps', surface)
      if (surface === 'tui') {
        const probe = spawnSync('go', ['version'], { encoding: 'utf-8' })
        if (probe.error || probe.status !== 0) { skips.push('tui: go toolchain not on PATH'); continue }
        const r = spawnSync('go', ['build', './...'], { cwd: surfaceDir, encoding: 'utf-8' })
        if (r.status === 0) passes.push('tui: go build')
        else fails.push(`tui: go build exit ${r.status} — ${(r.stderr || '').trim().split('\n')[0] ?? ''}`)
        continue
      }
      const tsc = join(PROJECT_DIR, 'node_modules', 'typescript', 'bin', 'tsc')
      const tsconfig = join(surfaceDir, 'tsconfig.json')
      if (!existsSync(tsc)) { skips.push(`${surface}: typescript not installed (npm install not run)`); continue }
      if (!existsSync(tsconfig)) { skips.push(`${surface}: no tsconfig.json`); continue }
      const r = spawnSync(process.execPath, [tsc, '--noEmit', '-p', tsconfig], { cwd: surfaceDir, encoding: 'utf-8' })
      if (r.status === 0) passes.push(`${surface}: tsc --noEmit`)
      else fails.push(`${surface}: tsc exit ${r.status} — ${(r.stdout || r.stderr || '').trim().split('\n')[0] ?? ''}`)
    }

    if (fails.length) rec('I3c', 'wired surface builds', 'fail', fails.slice(0, 3).join(' · '))
    else if (passes.length) {
      rec('I3c', 'wired surface builds', 'pass',
          passes.join(' · ') + (skips.length ? ` (skipped: ${skips.join(', ')})` : ''))
    } else {
      rec('I3c', 'wired surface builds', 'unverified', skips.join(' · ') || 'no buildable surface')
    }
  }
}

// ── report ─────────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n)
console.log(`\nfragment invariants — ${CMD} · ${PROJECT_DIR}\n`)
for (const r of results) {
  const mark = r.verdict === 'pass' ? 'PASS' : r.verdict === 'fail' ? 'FAIL' : 'UNVERIFIED'
  console.log(`  ${pad(r.id, 5)} ${pad(mark, 11)} ${pad(r.name, 42)} ${r.detail}`)
}
const fails = results.filter((r) => r.verdict === 'fail')
const unver = results.filter((r) => r.verdict === 'unverified')
console.log(`\n  ${results.filter((r) => r.verdict === 'pass').length} pass · ${fails.length} fail · ${unver.length} unverified`)
if (unver.length) console.log('  unverified is not pass — it is the absence of evidence, stated.')
console.log('')

hb(fails.length ? 'GATE_FAIL' : 'GATE_PASS')
process.exit(fails.length ? 1 : 0)
