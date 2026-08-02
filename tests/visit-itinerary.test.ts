import { describe, expect, it } from 'vitest';
import { formatDriveDuration } from '../src/engine/visit-itinerary.js';

describe('formatDriveDuration', () => {
  it('keeps short drives in minutes', () => {
    expect(formatDriveDuration(25)).toBe('~25 min');
    expect(formatDriveDuration(59)).toBe('~59 min');
  });

  it('uses hours for long inter-site drives', () => {
    expect(formatDriveDuration(60)).toBe('~1 hour');
    expect(formatDriveDuration(90)).toBe('~1.5 hours');
    expect(formatDriveDuration(236)).toBe('~4 hours');
  });
});
