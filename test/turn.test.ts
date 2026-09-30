import { beforeEach, describe, expect, it, vi } from 'vitest';

const reply = vi.fn();
vi.mock('../src/server/mistral.js', () => ({
  jsonCall: (...args: unknown[]) => reply(...args),
  tokenUsage: { prompt: 0, completion: 0, calls: 0 },
}));

const { runTurn } = await import('../src/server/turn.js');

const base = {
  answers: {
    orgName: 'Riverside',
    orgType: ['domiciliary'],
    staffSize: '11-50',
    nations: ['england'],
    nhs: 'no',
    stance: 'approved',
    aiInUse: 'informal',
  },
  history: [],
};

describe('runTurn', () => {
  beforeEach(() => reply.mockReset());

  it('keeps the current answer, a plan for a chosen tool, and other open single answers', async () => {
    reply.mockResolvedValue({
      values: {
        tools: ['chatgpt'],
        'plan:chatgpt': 'personal-paid',
        personalAccounts: 'yes',
        dpLead: 'Registered Manager',
      },
      stay: false,
      reply: 'Thanks. ChatGPT Plus is a personal plan.',
    });
    const out = await runTurn({
      ...base,
      slot: 'tools',
      message: 'ChatGPT Plus on their phones, I look after data protection',
    });
    expect(out.values).toEqual({
      tools: ['chatgpt'],
      'plan:chatgpt': 'personal-paid',
      personalAccounts: 'yes',
      dpLead: 'Registered Manager',
    });
    expect(out.stay).toBe(false);
  });

  it('never lets a passing mention answer a list question other than the current one', async () => {
    reply.mockResolvedValue({
      values: { tasks: ['visit-notes'], tools: ['claude'] },
      stay: false,
      reply: 'Noted.',
    });
    const out = await runTurn({ ...base, slot: 'tools', message: 'Claude, and we might do visit notes' });
    expect(out.values.tools).toEqual(['claude']);
    expect(out.values.tasks).toBeUndefined();
  });

  it('drops invalid values and stays on the question when it was not answered', async () => {
    reply.mockResolvedValue({ values: { tools: ['not-a-tool'], stance: 'maybe' }, stay: false, reply: '' });
    const out = await runTurn({ ...base, slot: 'tools', message: 'What is a DPA?' });
    expect(out.values).toEqual({});
    expect(out.stay).toBe(true);
    expect(out.reply).toMatch(/pick from the list/);
  });

  it('refuses a question that is not open', async () => {
    await expect(runTurn({ ...base, slot: 'orgName', message: 'x' })).rejects.toThrow(/no longer open/);
  });
});

describe('runTurn decisions', () => {
  it('never records a policy decision in passing', async () => {
    reply.mockResolvedValue({
      values: {
        aiInUse: 'informal',
        accountRule: 'work-only',
        personalDataEntered: 'yes',
        dpLead: 'Registered Manager',
      },
      stay: false,
      reply: 'Thanks.',
    });
    const out = await runTurn({
      answers: {
        orgName: 'R',
        orgType: ['domiciliary'],
        staffSize: '11-50',
        nations: ['england'],
        nhs: 'no',
        stance: 'approved',
      },
      history: [],
      slot: 'aiInUse',
      message: 'staff use ChatGPT on their phones, I do data protection',
    });
    expect(out.values).toEqual({ aiInUse: 'informal', dpLead: 'Registered Manager' });
  });
});
