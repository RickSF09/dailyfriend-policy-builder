// Tailoring: the one place the model writes policy text. It writes a purpose
// paragraph and one example sentence per chosen task, in the organisation's
// own setting. Each snippet must pass the grounding check or it is dropped and
// the fixed wording is used instead.

import { prune } from '../shared/engine.js';
import { type Answers, getSlot, list, text, toolName } from '../shared/interview.js';
import { USES } from '../shared/knowledge.generated.js';
import type { Snippets } from '../shared/policy/types.js';
import { checkGrounded, vocabulary } from './grounding.js';
import { chargeTokens, estimateTokens } from './limits.js';
import { jsonCall } from './mistral.js';

const MAX_OUTPUT = 1500;

const SYSTEM = `You tailor a few sentences of an AI use policy for a UK care organisation. The rest of the policy is fixed wording; you only write:

1. "purpose": two sentences saying what the policy is for, naming the organisation and the kind of service it runs. It must say the policy sets out which AI tools are approved, what they may and may not be used for, who checks the results, and what to do when something goes wrong.
2. "examples": for each task id given, one sentence (under 35 words) showing that task done safely in this organisation's kind of service, with a person checking the result. Describe who does it in everyday terms, such as "a care worker" or "a manager". Do not name any tool or product in the examples: which tools may be used for which tasks is decided elsewhere in the policy.

Rules:
- British English, plain and calm. No exclamation marks, no markdown, no brackets.
- Mention only the organisation name and service types you are given. Never invent names of people, places, products, organisations, laws or statistics. Use no numbers.
- Never suggest AI makes a decision about anyone's care, risk, eligibility or safeguarding.
- For tasks involving information about people, keep it clear that a person checks and corrects the draft.

Answer in JSON only, in exactly this shape:
{"purpose": "...", "examples": {"<task id>": "..."}}`;

export interface TailorResult {
  snippets: Snippets;
  rejected: number;
}

function optionLabels(a: Answers, id: string): string[] {
  const slot = getSlot(id);
  return list(a, id)
    .map((v) => slot?.options?.find((o) => o.id === v)?.label ?? '')
    .filter((l) => l && l !== 'Something else');
}

export async function runTailor(input: Answers): Promise<TailorResult> {
  const a = prune(input);
  const tasks = USES.filter((u) => list(a, 'tasks').includes(u.id));
  const tools = list(a, 'tools')
    .filter((t) => t !== 'none' && t !== 'other')
    .map(toolName);
  const services = [...optionLabels(a, 'orgType'), text(a, 'orgTypeOther')].filter(Boolean);

  const brief = [
    `Organisation: ${text(a, 'orgName') || 'the organisation'}`,
    `Services: ${services.join(', ') || 'care services'}`,
    `Size: ${String(a.staffSize ?? 'not given')} people`,
    `Tasks:\n${tasks.map((t) => `- ${t.id}: ${t.title} (${t.readiness === 'care' ? 'involves information about people' : 'no personal information'})`).join('\n') || '- none'}`,
  ].join('\n');

  const messages = [
    { role: 'system' as const, content: SYSTEM },
    { role: 'user' as const, content: brief },
  ];
  chargeTokens(estimateTokens(SYSTEM.length + brief.length, MAX_OUTPUT));
  const raw = await jsonCall<{ purpose?: unknown; examples?: unknown }>(messages, {
    temperature: 0.3,
    maxTokens: MAX_OUTPUT,
  });

  const vocab = vocabulary([
    ...Object.values(a)
      .flat()
      .filter((v): v is string => typeof v === 'string'),
    ...services,
    ...tools,
    ...tasks.map((t) => t.title),
  ]);
  let rejected = 0;
  const snippets: Snippets = {};

  if (typeof raw.purpose === 'string') {
    const purpose = raw.purpose.trim();
    if (checkGrounded(purpose, vocab, tools, 600).ok) snippets.purpose = purpose;
    else rejected++;
  }
  if (raw.examples && typeof raw.examples === 'object') {
    const examples: Record<string, string> = {};
    for (const t of tasks) {
      const v = (raw.examples as Record<string, unknown>)[t.id];
      if (typeof v !== 'string') continue;
      const sentence = v.trim();
      // No tool names at all: which tool may do which task is the register's job.
      if (checkGrounded(sentence, vocab, [], 260).ok) examples[t.id] = sentence;
      else rejected++;
    }
    snippets.examples = examples;
  }
  return { snippets, rejected };
}
