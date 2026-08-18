import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The golden battery is data, and every gate breach it produced on its first
 * live run was a defect in THIS FILE, not in an index: a name row that expected
 * a clone tenant's id, and a locations lane graded against a threshold the
 * shipped engine applies to something else entirely. Those are structural
 * mistakes, so they get a structural gate.
 */
const golden = JSON.parse(
  readFileSync(join(__dirname, '..', 'scripts', 'embed-pipeline', 'golden.json'), 'utf8'),
) as {
  gates: Record<string, number>;
  thresholds: Record<string, number | null | string>;
  intent: Array<{ text: string; expect_kind?: string; must_not_bind?: boolean }>;
  known_gaps: Array<{ text: string; why?: string }>;
  [env: string]: unknown;
};

const LANES = ['names', 'locations', 'education'] as const;
const ENVS = ['dev', 'prod'] as const;

describe('golden battery shape', () => {
  it('grades every intent row on exactly one expectation', () => {
    for (const row of golden.intent) {
      expect(!!row.expect_kind !== !!row.must_not_bind, `intent row "${row.text}"`).toBe(true);
    }
  });

  it('a lane with no bind threshold carries no must-not-bind trap', () => {
    // With no threshold the lane is graded on retrieval, so nothing can be
    // refused — a trap row there would be permanently red.
    for (const env of ENVS) {
      const block = golden[env] as Record<string, Array<{ must_not_bind?: boolean }>>;
      for (const lane of LANES) {
        const threshold = golden.thresholds[lane];
        if (threshold !== null && threshold !== undefined) continue;
        const traps = (block[lane] ?? []).filter((r) => r.must_not_bind);
        expect(traps, `${env}.${lane} is retrieval-only`).toHaveLength(0);
      }
    }
  });

  it('every graded lane row names the id it expects', () => {
    for (const env of ENVS) {
      const block = golden[env] as Record<string, Array<{ text: string; expect_id?: string; must_not_bind?: boolean }>>;
      for (const lane of LANES) {
        for (const row of block[lane] ?? []) {
          expect(!!row.expect_id !== !!row.must_not_bind, `${env}.${lane} row "${row.text}"`).toBe(true);
        }
      }
    }
  });

  it('every accepted miss states why, and is not also graded', () => {
    const gradedTexts = new Set<string>(golden.intent.map((r) => r.text));
    for (const env of ENVS) {
      const block = golden[env] as Record<string, Array<{ text: string }>>;
      for (const lane of LANES) for (const row of block[lane] ?? []) gradedTexts.add(row.text);
    }
    for (const gap of golden.known_gaps) {
      expect(gap.why, `known_gap "${gap.text}"`).toBeTruthy();
      expect(gradedTexts.has(gap.text), `"${gap.text}" is both graded and excused`).toBe(false);
    }
  });
});
