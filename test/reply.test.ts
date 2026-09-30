import { describe, expect, it } from 'vitest';
import { tidyReply } from '../src/server/turn.js';

const warned = [
  {
    role: 'assistant',
    content:
      'Thank you. Using personal accounts for Claude carries a risk as there is no data processing agreement.',
  },
];

describe('tidyReply', () => {
  it('drops a question once the answer is recorded, because the page asks the next one', () => {
    expect(tidyReply('Thank you. What kind of service do you run?', 'I am the CEO', [], true)).toBe(
      'Thank you.',
    );
  });

  it('keeps the question when the answer is still needed', () => {
    expect(
      tidyReply('It is the NHS self-assessment. Do you complete it?', 'what is the dspt', [], false),
    ).toContain('Do you complete it?');
  });

  it('drops a risk warning when the message says nothing about tools or accounts', () => {
    const r = tidyReply(
      'Thank you. Using a personal plan for Claude carries a risk because it has no data processing agreement.',
      'our CTO',
      warned,
      true,
    );
    expect(r).toBe('Thank you.');
  });

  it('does not warn when a tool is named without any account', () => {
    expect(
      tidyReply(
        'Noted. Using Claude on personal accounts carries a risk.',
        "copilot yes, claude we're still thinking about",
        [],
        true,
      ),
    ).toBe('Noted.');
  });

  it('does not repeat the point in other words', () => {
    const general = [
      {
        role: 'assistant',
        content:
          'Thank you. Using personal accounts for work carries a risk as there is no data processing agreement.',
      },
    ];
    expect(
      tidyReply(
        'Noted. Using Claude on personal plans carries a risk.',
        'claude on their own accounts still',
        general,
        true,
      ),
    ).toBe('Noted.');
  });

  it('does not repeat a risk an earlier reply already gave', () => {
    const r = tidyReply(
      'Noted. Using Claude on personal plans carries a risk as there is no data processing agreement.',
      'copilot yes, claude still thinking',
      warned,
      true,
    );
    expect(r).toBe('Noted.');
  });

  it('gives the warning the first time a tool and account are named', () => {
    const r = tidyReply(
      'Thank you. Using personal accounts for Claude carries a risk as there is no data processing agreement.',
      'some use claude on their own accounts',
      [],
      true,
    );
    expect(r).toContain('data processing agreement');
  });
});
