import { describe, expect, it } from 'vitest';
import { silEvalAllowed } from '../src/understanding/sil-probe.js';

const req = (secret?: string) =>
  new Request('http://spine/api/sil/probe', {
    method: 'POST',
    ...(secret ? { headers: { 'x-bot-secret': secret } } : {}),
  });

describe('silEvalAllowed — the measurement doors', () => {
  it('opens on dev via the eval flag, no secret needed', () => {
    expect(silEvalAllowed({ SIL_EVAL_ENABLED: 'true' }, req())).toBe(true);
  });

  it('opens on prod (flag unset) to the bot secret', () => {
    expect(silEvalAllowed({ BOT_SHARED_SECRET: 's3cret' }, req('s3cret'))).toBe(true);
  });

  it('stays a 404 to the wrong secret', () => {
    expect(silEvalAllowed({ BOT_SHARED_SECRET: 's3cret' }, req('wrong'))).toBe(false);
  });

  it('stays a 404 with no secret configured — an unset secret must never mean open', () => {
    expect(silEvalAllowed({}, req(''))).toBe(false);
    expect(silEvalAllowed({ BOT_SHARED_SECRET: '' }, req(''))).toBe(false);
  });

  it('flag values other than the string "true" do not open the door', () => {
    expect(silEvalAllowed({ SIL_EVAL_ENABLED: '1' }, req())).toBe(false);
    expect(silEvalAllowed({ SIL_EVAL_ENABLED: 'false' }, req())).toBe(false);
  });

  describe('SIL_EVAL_SECRET — the least-privilege measurement key', () => {
    it('opens the door on its own, with no bot secret configured at all', () => {
      expect(silEvalAllowed({ SIL_EVAL_SECRET: 'eval-key' }, req('eval-key'))).toBe(true);
    });

    it('opens alongside a DIFFERENT bot secret — the point is not having to share it', () => {
      const env = { BOT_SHARED_SECRET: 'bot-key', SIL_EVAL_SECRET: 'eval-key' };
      expect(silEvalAllowed(env, req('eval-key'))).toBe(true);
      expect(silEvalAllowed(env, req('bot-key'))).toBe(true);
      expect(silEvalAllowed(env, req('neither'))).toBe(false);
    });

    it('an empty eval key never opens the door', () => {
      expect(silEvalAllowed({ SIL_EVAL_SECRET: '' }, req(''))).toBe(false);
      expect(silEvalAllowed({ SIL_EVAL_SECRET: '' }, req('anything'))).toBe(false);
    });

    it('a missing header is refused before either key is consulted', () => {
      expect(silEvalAllowed({ BOT_SHARED_SECRET: 'bot-key', SIL_EVAL_SECRET: 'eval-key' }, req())).toBe(false);
    });
  });
});
