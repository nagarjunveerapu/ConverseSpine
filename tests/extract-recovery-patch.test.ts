import { describe, expect, it } from 'vitest';
import { extractRecoveryPatchFromText } from '../src/engine/turn-intent/extract-recovery-patch.js';

describe('extractRecoveryPatchFromText', () => {
  it('parses bare budget amount in recovery mode', () => {
    const intent = extractRecoveryPatchFromText('increase budget to 3 Cr', 'search_recovery');
    expect(intent?.kind).toBe('apply_recovery_patch');
    expect(intent?.patch?.budgetMaxInr).toBe(30_000_000);
  });

  it('ignores budget text outside recovery modes', () => {
    expect(extractRecoveryPatchFromText('increase budget to 3 Cr', 'brief_collect')).toBeNull();
  });

  it('clears bhk on any configuration phrasing', () => {
    const intent = extractRecoveryPatchFromText('2 Cr any apartment', 'search_recovery');
    expect(intent?.patch_clear).toContain('bhk');
    expect(intent?.patch?.propertyType).toBe('Apartment');
  });

  it('parses location and type in compound recovery text', () => {
    const intent = extractRecoveryPatchFromText(
      'broader Bangalore area and switch to apartment',
      'search_recovery',
    );
    expect(intent?.patch?.location).toBe('Bangalore');
    expect(intent?.patch?.propertyType).toBe('Apartment');
  });
});
