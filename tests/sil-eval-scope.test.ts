import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * SIL_EVAL_SECRET exists so the nightly gate does NOT have to hold
 * BOT_SHARED_SECRET on prod — that key also HMACs Desk's signed media URLs, so
 * sharing or rotating it for a measurement job is buyer-visible.
 *
 * That promise is only worth as much as the set of routes `silEvalAllowed`
 * guards. If someone later reaches for it on a rebuild route or a writer,
 * the narrow key silently becomes a wide one. So the promise gets a test.
 */
const src = readFileSync(join(__dirname, '..', 'src', 'index.ts'), 'utf8');

/** Every `path === '…'` that appears within a few lines above a silEvalAllowed guard. */
function routesGuardedByEvalGate(): string[] {
  const lines = src.split('\n');
  const found: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('silEvalAllowed(')) continue;
    for (let j = i; j >= Math.max(0, i - 6); j--) {
      const m = /path === '([^']+)'/.exec(lines[j]);
      if (m) {
        found.push(m[1]);
        break;
      }
    }
  }
  return found;
}

describe('the measurement key stays a measurement key', () => {
  it('guards the two read-only probe routes and nothing else', () => {
    expect(routesGuardedByEvalGate().sort()).toEqual(['/api/sil/embed', '/api/sil/probe']);
  });

  it('never guards an /internal/ route — those mutate indexes and send messages', () => {
    for (const route of routesGuardedByEvalGate()) {
      expect(route.startsWith('/internal/'), `${route} is gated by silEvalAllowed`).toBe(false);
    }
  });

  it('every /internal/ route still checks BOT_SHARED_SECRET itself', () => {
    const internalRoutes = [...src.matchAll(/path === '(\/internal\/[^']+)'/g)].map((m) => m[1]);
    expect(internalRoutes.length).toBeGreaterThan(0);
    for (const route of internalRoutes) {
      const start = src.indexOf(`path === '${route}'`);
      const block = src.slice(start, start + 600);
      expect(block.includes('BOT_SHARED_SECRET'), `${route} has no bot-secret check`).toBe(true);
    }
  });
});
