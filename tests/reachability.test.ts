/**
 * Nothing in `src/` may be unreachable from every real entry point.
 *
 * These files are not an older engine that aged out. They arrived in the very
 * first commit (ca98f80, 2026-07-06) alongside the engine that shipped, and
 * **no source file has ever imported them** — the reference count at that commit
 * is identical to the count today. A tool-registry / LLM-composer / NLU-pipeline
 * scaffold was laid down, the deterministic `src/engine` path was the one that
 * got wired, and the scaffold was never removed. It still typechecks and still
 * has passing tests, and it cannot affect a single buyer reply.
 *
 * That is not tidiness. `src/nlu/extractors.ts` holds two per-tenant project-name
 * regexes:
 *
 *   const BRIGADE_PROJECT_RE = /\b(brigade\s+(?:eldorado|orchards|calista|…
 *
 * Anyone tracing "the bot missed a project name" finds them, adds a third
 * tenant's names, and has written a regex fix in the embedding lane — the one
 * thing we do not do — in code that could not have changed the answer anyway.
 * The cost of an unmarked dead lane is paid in a wrong fix, not in disk.
 *
 * So this test draws the line where it actually is:
 *
 *   dead        reachable from nothing at all → must be empty
 *   test-only   reachable only from its own tests → must match TEST_ONLY
 *
 * A new orphan fails the first assertion. Reviving or deleting part of the
 * scaffold fails the second, which is the point: the list is the debt, written
 * down rather than carried in someone's head.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The rest of the never-wired scaffold. Every file here is reachable ONLY from
 * its own tests — no deployed path, no script — and has been since the first
 * commit. Shrinking this list is the goal; growing it needs a reason in the PR
 * that does it.
 */
const TEST_ONLY = [
  'src/channel/wa-brief.ts', // the live WhatsApp brief is channel/wa-pack.ts
  'src/compose/render.ts',
  'src/compose/templates.ts',
  'src/experience/copy.ts',
  'src/graphs/objection.ts',
  'src/graphs/visit.ts',
  'src/nlu/extractors.ts', // holds the per-tenant name regexes described above
  'src/turn/decide.ts',
].map((p) => path.normalize(p));

const exists = (p: string): boolean => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

function walk(dir: string, match: RegExp): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!/node_modules|dist|\.git|\.wrangler/.test(p)) out.push(...walk(p, match));
    } else if (match.test(p)) {
      out.push(path.normalize(p));
    }
  }
  return out;
}

/** Resolve a relative specifier, allowing the .js-extension-for-.ts convention. */
function resolveSpec(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.normalize(path.join(path.dirname(from), spec));
  for (const cand of [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, path.join(base, 'index.ts')]) {
    if (exists(cand)) return path.normalize(cand);
  }
  return null;
}

function importsOf(file: string): string[] {
  let src: string;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const specs: string[] = [];
  const patterns = [
    /from\s+['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      const r = resolveSpec(file, m[1]!);
      if (r) specs.push(r);
    }
  }
  return specs;
}

function reachableFrom(entries: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const queue = entries.filter(exists).map((e) => path.normalize(e));
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const next of importsOf(f)) queue.push(next);
  }
  return seen;
}

/** Every entry that actually runs: the deployed Worker, plus each npm script. */
function realEntries(): string[] {
  const entries: string[] = [];
  const wrangler = fs.readFileSync('wrangler.toml', 'utf8');
  const main = /^\s*main\s*=\s*["']([^"']+)["']/m.exec(wrangler);
  if (main) entries.push(main[1]!);
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> };
  for (const cmd of Object.values(pkg.scripts ?? {})) {
    for (const m of cmd.matchAll(/(?:tsx|node)\s+([\w./-]+\.ts)/g)) entries.push(m[1]!);
    for (const m of cmd.matchAll(/vitest run\s+([\w./-]+\.test\.ts)/g)) entries.push(m[1]!);
  }
  return entries;
}

describe('src reachability', () => {
  const srcFiles = walk('src', /\.ts$/).filter((f) => !/\.test\.ts$/.test(f));
  const live = reachableFrom(realEntries());
  const viaTests = reachableFrom(walk('tests', /\.test\.ts$/));

  it('has a real entry point to walk from', () => {
    // Guards the guard: if wrangler.toml or package.json changes shape, this
    // test would silently pass by reaching nothing and calling everything dead.
    expect(realEntries().length).toBeGreaterThan(3);
    expect(live.size).toBeGreaterThan(50);
  });

  it('no source file is unreachable from every entry and every test', () => {
    const dead = srcFiles.filter((f) => !live.has(f) && !viaTests.has(f)).sort();
    expect(dead).toEqual([]);
  });

  it('the never-wired scaffold is exactly what is written down', () => {
    const testOnly = srcFiles.filter((f) => !live.has(f) && viaTests.has(f)).sort();
    expect(testOnly).toEqual([...TEST_ONLY].sort());
  });
});
