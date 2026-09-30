import { Packer } from 'docx';
import { describe, expect, it } from 'vitest';
import { PERSONAS } from '../eval/personas.js';
import { assemblePolicy } from '../src/shared/policy/assemble.js';
import { buildDocx } from '../src/web/docx.js';

describe('buildDocx', () => {
  it('produces a Word file for every persona', async () => {
    for (const p of PERSONAS) {
      const buf = await Packer.toBuffer(buildDocx(assemblePolicy(p.answers)));
      expect(buf.subarray(0, 2).toString(), p.id).toBe('PK');
      expect(buf.length, p.id).toBeGreaterThan(5000);
    }
  });
});
