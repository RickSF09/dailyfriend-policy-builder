import { describe, expect, it } from 'vitest';
import { applyValues, coerce, matchOption, nextSlot, progress, prune } from '../src/shared/engine.js';
import { getSlot, UNSURE, visibleSlots } from '../src/shared/interview.js';
import { PERSONAS } from '../eval/personas.js';

const ids = (a: Record<string, string | string[]>) => visibleSlots(a).map((s) => s.id);

describe('interview order', () => {
  it('starts with the organisation name', () => {
    expect(nextSlot({})?.id).toBe('orgName');
  });

  it('asks the account for each chosen tool straight after the tools', () => {
    const order = ids({ stance: 'approved', tools: ['chatgpt', 'other'] });
    const at = order.indexOf('toolsOther');
    expect(order.slice(at, at + 3)).toEqual(['toolsOther', 'plan:chatgpt', 'plan:other']);
  });

  it('skips tools, tasks and the account rule when the stance is no AI', () => {
    const order = ids({ stance: 'none' });
    for (const id of ['tools', 'accountRule', 'tasks', 'personalData']) expect(order).not.toContain(id);
  });

  it('still covers AI built into existing systems when the stance is no AI', () => {
    const order = ids({ stance: 'none', embedded: ['monitoring'] });
    expect(order).toContain('monitoringConsent');
    expect(order).toContain('dpia');
    expect(order).toContain('dpa');
  });

  it('does not ask about personal data when a chosen task already involves it', () => {
    expect(ids({ tasks: ['visit-notes'] })).not.toContain('personalData');
    expect(ids({ tasks: ['funding-bids'] })).toContain('personalData');
  });

  it('asks the data protection questions only when personal data is involved', () => {
    const general = { stance: 'approved', tools: ['chatgpt'], tasks: ['funding-bids'], personalData: 'no' };
    expect(ids(general)).not.toContain('dpia');
    expect(ids({ ...general, personalData: UNSURE })).toContain('dpia');
  });

  it('reaches the end for every persona', () => {
    for (const p of PERSONAS) {
      expect(nextSlot(p.answers), p.id).toBeNull();
      const { done, total } = progress(p.answers);
      expect(done, p.id).toBe(total);
    }
  });
});

describe('coerce', () => {
  it('accepts only listed options', () => {
    const slot = getSlot('staffSize')!;
    expect(coerce(slot, '11-50')).toBe('11-50');
    expect(coerce(slot, 'lots')).toBeUndefined();
    expect(coerce(slot, UNSURE)).toBe(UNSURE);
  });

  it('recovers a list the model returned as one string', () => {
    expect(coerce(getSlot('embedded')!, ["care-records', 'rostering"])).toEqual([
      'care-records',
      'rostering',
    ]);
  });

  it('drops "none" when a real tool is also picked', () => {
    expect(coerce(getSlot('tools')!, ['none', 'chatgpt', 'made-up'])).toEqual(['chatgpt']);
  });

  it('tidies and caps text', () => {
    const v = coerce(getSlot('orgName')!, `  Riverside   ${'x'.repeat(300)}`);
    expect(typeof v === 'string' && v.startsWith('Riverside x') && v.length === 120).toBe(true);
  });
});

describe('role answers', () => {
  it('treats "no one right now" as not decided', () => {
    expect(coerce(getSlot('checker')!, 'No one right now')).toBe(UNSURE);
    expect(coerce(getSlot('checker')!, 'Nobody yet')).toBe(UNSURE);
    expect(coerce(getSlot('checker')!, 'Deputy Manager')).toBe('Deputy Manager');
  });

  it('does not ask how often when nobody spot-checks', () => {
    expect(ids({ checker: UNSURE })).not.toContain('checkRate');
    expect(ids({ checker: 'No one right now' })).not.toContain('checkRate');
    expect(ids({ checker: 'Deputy Manager' })).toContain('checkRate');
  });
});

describe('tools already agreed', () => {
  it('is asked after the accounts, about work-account tools only', () => {
    const a = { stance: 'approved', tools: ['chatgpt', 'claude'], 'plan:chatgpt': 'free' };
    const slots = visibleSlots(a);
    const order = slots.map((s) => s.id);
    expect(order.indexOf('agreed')).toBe(order.indexOf('plan:claude') + 1);
    expect(slots.find((s) => s.id === 'agreed')?.options?.map((o) => o.id)).toEqual(['claude', 'none']);
  });

  it('is not asked when every tool is on a personal plan', () => {
    expect(ids({ stance: 'approved', tools: ['chatgpt'], 'plan:chatgpt': 'free' })).not.toContain('agreed');
  });
});

describe('applyValues and prune', () => {
  it('records a plan together with its tool in one patch', () => {
    const a = applyValues({ stance: 'approved' }, { 'plan:claude': 'business', tools: ['claude'] });
    expect(a['plan:claude']).toBe('business');
  });

  it('prunes a plan when its tool is removed', () => {
    const a = prune({ stance: 'approved', tools: ['chatgpt'], 'plan:claude': 'business' });
    expect(a['plan:claude']).toBeUndefined();
  });

  it('ignores unknown questions', () => {
    expect(applyValues({}, { nonsense: 'x' })).toEqual({});
  });
});

describe('optional questions', () => {
  it('treats "no" or "nothing else" as a skip, not an answer', () => {
    const slot = getSlot('redLines')!;
    expect(coerce(slot, 'No, nothing else')).toBe(UNSURE);
    expect(coerce(slot, 'nothing')).toBe(UNSURE);
    expect(coerce(slot, "No, that's it for now")).toBe(UNSURE);
    expect(coerce(slot, 'No, that covers it')).toBe(UNSURE);
    expect(coerce(slot, 'No, that covers it for us.')).toBe(UNSURE);
    expect(coerce(slot, 'No AI in anything care-related')).toBe('No AI in anything care-related');
    expect(coerce(slot, 'Nothing about end of life care')).toBe('Nothing about end of life care');
  });
});

describe('reworded questions', () => {
  it('names the tools and systems in the DPA question', () => {
    const a = {
      stance: 'approved',
      tools: ['chatgpt', 'magic-notes'],
      'plan:chatgpt': 'free',
      'plan:magic-notes': 'business',
      embedded: ['care-records'],
      tasks: ['visit-notes'],
    };
    const q = visibleSlots(a).find((s) => s.id === 'dpa')?.question;
    expect(q).toBe(
      'Do you have a data processing agreement (DPA) with the supplier of each of Magic Notes and your care records system?',
    );
  });
});

describe('matchOption', () => {
  it('matches yes, no, not sure and option wording without a model', () => {
    expect(matchOption(getSlot('breachProcedure')!, 'No')).toBe('no');
    expect(matchOption(getSlot('breachProcedure')!, 'yes.')).toBe('yes');
    expect(matchOption(getSlot('dpia')!, 'no')).toBe('no');
    expect(matchOption(getSlot('ownDevices')!, 'Some do')).toBe('some');
    expect(matchOption(getSlot('owner')!, "I'm not sure")).toBe(UNSURE);
    expect(matchOption(getSlot('reviewMonths')!, 'In 12 months')).toBe('12');
    expect(matchOption(getSlot('staffSize')!, '11 to 50')).toBe('11-50');
  });

  it('leaves anything longer to the model', () => {
    expect(matchOption(getSlot('dpia')!, 'no, but we plan to')).toBeUndefined();
    expect(matchOption(getSlot('orgName')!, 'Riverside')).toBeUndefined();
  });
});
