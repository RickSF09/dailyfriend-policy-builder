import { beforeEach, describe, expect, it, vi } from 'vitest';

const reply = vi.fn();
vi.mock('../src/server/mistral.js', () => ({
  jsonCall: (...args: unknown[]) => reply(...args),
  tokenUsage: { prompt: 0, completion: 0, calls: 0 },
}));

const { tailorWording } = await import('../src/server/tailor.js');

const answers = {
  orgName: 'Carematch',
  approver: 'As a CEO I review it and bring it to the board to decide',
  checker: 'We have not got anyone for this yet',
  reportTo: 'Registered Manager',
  redLines: 'Never the final decision, escpesially on care plans',
};

describe('tailorWording', () => {
  beforeEach(() => reply.mockReset());

  it('makes no call when there is nothing typed to tidy', async () => {
    expect(await tailorWording({ orgName: 'Carematch' })).toEqual({ rejected: 0 });
    expect(reply).not.toHaveBeenCalled();
  });

  it('keeps grounded wording, records "nobody" as a gap, and remembers the source answer', async () => {
    reply.mockResolvedValue({
      roles: {
        approver: { phrase: 'the board', cell: 'CEO reviews; the board decides' },
        checker: { none: true },
        reportTo: { phrase: 'their line manager', cell: 'line manager' },
      },
      redLines: ['To make the final decision, especially on care plans.'],
    });
    const { wording, rejected } = await tailorWording(answers);
    expect(rejected).toBe(0);
    expect(wording?.roles?.approver).toEqual({
      from: answers.approver,
      phrase: 'the board',
      cell: 'CEO reviews; the board decides',
    });
    expect(wording?.roles?.checker).toEqual({ from: answers.checker, none: true });
    expect(wording?.roles?.reportTo).toMatchObject({ phrase: 'your line manager', cell: 'Line manager' });
    expect(wording?.redLines).toEqual({
      from: answers.redLines,
      items: ['to make the final decision, especially on care plans'],
    });
  });

  it('drops wording that invents a name or will not fit mid-sentence', async () => {
    reply.mockResolvedValue({
      roles: {
        approver: { phrase: 'Margaret, the chair', cell: 'Margaret' },
        reportTo: { phrase: 'the Registered Manager. Then the board', cell: 'Registered Manager' },
      },
      redLines: ['to write anything for Leeds City Council'],
    });
    const { wording, rejected } = await tailorWording(answers);
    expect(wording?.roles).toBeUndefined();
    expect(wording?.redLines).toBeUndefined();
    expect(rejected).toBe(3);
  });
});
