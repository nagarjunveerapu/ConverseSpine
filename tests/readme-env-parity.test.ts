import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The README documents which vars each env sets, and how many. Hand-maintained
 * counts rot — the registry did exactly this — so wrangler.toml grades the doc.
 * If you add or move a var and this fails, the README is the thing to fix.
 */
const root = join(__dirname, '..');
const toml = readFileSync(join(root, 'wrangler.toml'), 'utf8');
const readme = readFileSync(join(root, 'README.md'), 'utf8');

function varsFor(env: string): Set<string> {
  const m = new RegExp(`^\\[env\\.${env}\\.vars\\]\\s*$([\\s\\S]*?)(?=^\\[)`, 'm').exec(toml);
  const out = new Set<string>();
  for (const line of (m?.[1] ?? '').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    out.add(t.split('=')[0].trim());
  }
  return out;
}

const dev = varsFor('dev');
const prod = varsFor('prod');
const devOnly = [...dev].filter((k) => !prod.has(k)).sort();

describe('README documents the real env surface', () => {
  it('states the var counts wrangler.toml actually has', () => {
    expect(dev.size, 'dev vars').toBeGreaterThan(0);
    expect(readme).toContain(`dev has ${dev.size}, prod has ${prod.size}`);
  });

  it('states the real size of the dev-only set', () => {
    expect(readme).toContain(`Set on dev, unset on prod (${devOnly.length})`);
  });

  it('names every dev-only var, so none goes silently undocumented', () => {
    const section = readme.slice(readme.indexOf('Set on dev, unset on prod'));
    const missing = devOnly.filter((k) => {
      if (k.startsWith('FAILURE_')) return !section.includes('`FAILURE_'); // grouped
      return !section.includes(`\`${k}\``);
    });
    expect(missing, 'dev-only vars absent from the README').toEqual([]);
  });

  it('documents every secret the code reads from env as a secret', () => {
    for (const secret of ['BOT_SHARED_SECRET', 'DEEPSEEK_API_KEY', 'SIL_EVAL_SECRET']) {
      expect(readme, `${secret} undocumented`).toContain(secret);
      expect(dev.has(secret) || prod.has(secret), `${secret} is a var, not a secret`).toBe(false);
    }
  });
});
