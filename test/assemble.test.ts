import { describe, expect, it } from 'vitest';
import { PERSONAS } from '../eval/personas.js';
import { assemblePolicy } from '../src/shared/policy/assemble.js';
import type { Block, PolicyDoc } from '../src/shared/policy/types.js';
import { rolePhrase } from '../src/shared/policy/words.js';

const TODAY = new Date('2026-09-30T10:00:00Z');

function allText(doc: PolicyDoc): string {
  const flat = (b: Block): string[] =>
    b.kind === 'bullets' ? b.items : b.kind === 'table' ? [...b.head, ...b.rows.flat()] : [b.text];
  return [
    ...doc.sections.flatMap((s) => [s.title, ...s.blocks.flatMap(flat)]),
    ...doc.summary.blocks.flatMap(flat),
  ].join('\n');
}

describe('assemblePolicy', () => {
  for (const p of PERSONAS) {
    describe(p.id, () => {
      const doc = assemblePolicy(p.answers, {}, TODAY);
      const text = allText(doc);

      it('has all fifteen sections, in a stable order', () => {
        expect(doc.sections).toHaveLength(15);
        expect(doc.sections[3]?.id).toBe('tools');
        expect(doc.sections[11]?.id).toBe('new-tools');
      });

      it('names the right regulator', () => {
        expect(text).toContain(p.expect.regulator);
      });

      it('contains the expected clauses', () => {
        for (const t of p.expect.text) expect(text).toContain(t);
      });

      it('never mentions a tool they did not choose', () => {
        for (const name of ['Otter', 'Grammarly', 'Claude']) {
          if (!JSON.stringify(p.answers).includes(name.toLowerCase())) expect(text).not.toContain(name);
        }
      });

      it('gives the action plan they need', () => {
        const ids = doc.actions.map((a) => a.id);
        for (const id of p.expect.actions) expect(ids).toContain(id);
        for (const id of p.expect.noActions ?? []) expect(ids).not.toContain(id);
      });
    });
  }

  it('marks unanswered roles as gaps instead of guessing', () => {
    const doc = assemblePolicy({ orgName: 'Test' }, {}, TODAY);
    expect(allText(doc)).toContain('[TO DECIDE: policy owner]');
    expect(doc.gaps).toBeGreaterThan(5);
    expect(doc.actions.map((a) => a.id)).toContain('gaps');
  });

  it('only cites CQC regulations for services in England', () => {
    const wales = PERSONAS.find((p) => p.id === 'wales-provider')!;
    const text = allText(assemblePolicy(wales.answers, {}, TODAY));
    expect(text).not.toContain('Regulation 17');
    expect(text).not.toContain('CQC approved');
  });

  it('warns about a tool whose terms say it trains on what users put in', () => {
    const doc = assemblePolicy({ stance: 'approved', tools: ['otter'], 'plan:otter': 'business' }, {}, TODAY);
    expect(allText(doc)).toContain('trains its AI on what users put in');
    expect(doc.actions.map((a) => a.id)).toContain('trains-otter');
  });

  it('uses tailored wording when given, and defaults otherwise', () => {
    const p = PERSONAS[0]!;
    const tailored = assemblePolicy(p.answers, { examples: { 'visit-notes': 'Tailored example.' } }, TODAY);
    expect(allText(tailored)).toContain('Tailored example.');
    expect(allText(assemblePolicy(p.answers, {}, TODAY))).toContain('spoken summary');
  });

  it('dates the review from the chosen interval', () => {
    const doc = assemblePolicy({ reviewMonths: '6' }, {}, TODAY);
    expect(doc.meta.find(([k]) => k === 'Review by')?.[1]).toBe('30 March 2027');
  });

  it('only links to hub pages that exist', () => {
    for (const p of PERSONAS) {
      for (const a of assemblePolicy(p.answers, {}, TODAY).actions) {
        if (a.link) expect(a.link.url).toMatch(/^https:\/\/.+\/(guides|templates|tools)\/[a-z0-9-]+$/);
      }
    }
  });
});

describe('rolePhrase', () => {
  it('adds "the" to a role but not to a name', () => {
    expect(rolePhrase('Registered Manager')).toBe('the Registered Manager');
    expect(rolePhrase('Our deputy manager')).toBe('Our deputy manager');
    expect(rolePhrase('Sue Smith')).toBe('Sue Smith');
  });
});
