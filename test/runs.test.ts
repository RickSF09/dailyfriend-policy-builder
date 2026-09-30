import { describe, expect, it } from 'vitest';
import { runs } from '../src/shared/policy/runs.js';

describe('runs', () => {
  it('keeps bold on both sides of a gap inside a bold phrase', () => {
    expect(runs('**Tell [TO DECIDE: who] now.** Then rest.')).toEqual([
      { text: 'Tell ', bold: true },
      { text: '[TO DECIDE: who]', gap: true, bold: true },
      { text: ' now.', bold: true },
      { text: ' Then rest.', bold: false },
    ]);
  });
});
