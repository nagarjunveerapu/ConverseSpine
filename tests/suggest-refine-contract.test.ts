import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { mapAdvisorTurnResponse } from '../src/advisor/map-response.js';
import type { ConversationState, TurnDebug } from '../src/engine/types.js';

/**
 * The engine states what it did; the client never re-derives it from prose.
 *
 * The SPA used to decide whether to offer "refine your search" chips by running
 * regexes over the reply the engine had just written — matching phrases like
 * "no exact match", and place names like /Aerospace|Corridor/. Reword one
 * sentence and the chips silently stop appearing: no error, no failing test,
 * the buyer just hits a dead end. Launch in another city and it misfires.
 *
 * `suggest_refine` is not new information. It is information the engine already
 * had, arriving intact.
 */
const state = {
  convId: 'c1',
  phase: 'discover',
  builderId: 'naya-advisor',
  constraints: {},
  discover: { lastOffered: [] },
} as unknown as ConversationState;

const debugFor = (kind: string): TurnDebug =>
  ({ phase: 'discover', goal: { kind }, tools: [], grounding: 'pass' }) as unknown as TurnDebug;

const map = (kind: string, searchRecovery?: unknown) =>
  mapAdvisorTurnResponse({
    sessionId: 's1',
    state,
    reply: 'anything at all',
    debug: debugFor(kind),
    ...(searchRecovery ? { searchRecovery } : {}),
  } as Parameters<typeof mapAdvisorTurnResponse>[0]);

describe('suggest_refine is stated, not inferred', () => {
  it('is true when nothing matched', () => {
    expect(map('no_fit').suggest_refine).toBe(true);
  });

  it('is true when re-offering after a rejection', () => {
    expect(map('ack_reject_recommend').suggest_refine).toBe(true);
  });

  it('is true when the recovery lane produced actions', () => {
    expect(map('recommend', { suggested_actions: [{ label: 'Widen area' }] }).suggest_refine)
      .toBe(true);
  });

  it('is false on an ordinary answer', () => {
    expect(map('answer').suggest_refine).toBe(false);
    expect(map('recommend').suggest_refine).toBe(false);
  });

  it('does not depend on the wording of the reply', () => {
    // The whole point. Two replies whose text would have flipped the old regex
    // (`/no exact match/i`) must produce the SAME flag, because the flag comes
    // from what the engine DID, not from what it said.
    const a = mapAdvisorTurnResponse({
      sessionId: 's', state, reply: 'No exact match for Devanahalli.', debug: debugFor('answer'),
    } as Parameters<typeof mapAdvisorTurnResponse>[0]);
    const b = mapAdvisorTurnResponse({
      sessionId: 's', state, reply: 'Here you go.', debug: debugFor('answer'),
    } as Parameters<typeof mapAdvisorTurnResponse>[0]);
    expect(a.suggest_refine).toBe(b.suggest_refine);
    expect(a.suggest_refine).toBe(false);
  });

  it('is always present, so the client can rely on it', () => {
    // An optional flag would send the client straight back to guessing whenever
    // it is absent. Every advisor response carries it.
    expect(map('greet')).toHaveProperty('suggest_refine');
  });
});

describe('the engine does not read its own prose', () => {
  it('no advisor/engine source matches the reply text to infer state', () => {
    const offenders: string[] = [];
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of readdirSync(dir)) {
        const full = join(dir, e);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (e.endsWith('.ts') && !e.endsWith('.test.ts')) out.push(full);
      }
      return out;
    };
    for (const file of walk('src/advisor')) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        // Comments explaining WHY this rule exists are not violations of it.
        if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
        // A regex literal matching reply wording, or a place name inside one.
        const rx = /\/[^/\n]*(?:no exact match|want to adjust|other options in|Aerospace|Corridor)[^/\n]*\/[gimsuy]*/i;
        if (rx.test(line)) offenders.push(`${file}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(offenders, `matching on reply prose or hardcoded places:\n${offenders.join('\n')}`)
      .toEqual([]);
  });
});
