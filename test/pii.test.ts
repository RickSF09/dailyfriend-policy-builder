import { describe, expect, it } from 'vitest';
import { findPii, isValidNhsNumber } from '../src/shared/pii.js';

describe('findPii', () => {
  const found = (text: string) => findPii(text).map((h) => h.type);

  it('finds identifiers someone might type about a person', () => {
    expect(found('Mrs B, NHS 573 856 3913, lives at CF62 7AB, 07700 900123')).toEqual(
      expect.arrayContaining(['NHS number', 'postcode', 'phone number']),
    );
    expect(found('DOB: 14/03/1941')).toEqual(['date of birth']);
  });

  it('stays quiet for ordinary answers about the organisation', () => {
    expect(found('About 30 staff, mostly home care, we use ChatGPT Plus and Copilot')).toEqual([]);
    expect(found('Registered Manager, reviewed every 12 months')).toEqual([]);
  });

  it('checks NHS number check digits', () => {
    expect(isValidNhsNumber('573 856 3913')).toBe(true);
    expect(isValidNhsNumber('573 856 3914')).toBe(false);
  });
});
