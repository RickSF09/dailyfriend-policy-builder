// Tailoring: the one place the model writes policy text. Two calls, run side
// by side so building takes no longer:
//  - a purpose paragraph and one example sentence per chosen task, in the
//    organisation's own setting;
//  - wording: typed answers (roles, their own red lines, other tasks) fitted
//    into the sentences the policy puts them in, so "As CEO I review it and
//    the board decides" never lands in "approved by ___" as typed.
// Each snippet must pass the grounding check or it is dropped and the fixed
// wording is used instead.

import { prune } from '../shared/engine.js';
import {
  type Answers,
  getSlot,
  isNobody,
  list,
  ROLE_TEXT_SLOTS,
  text,
  toolName,
} from '../shared/interview.js';
import { USES } from '../shared/knowledge.generated.js';
import type { RoleWording, Snippets, Wording } from '../shared/policy/types.js';
import { capitalise, rolePhrase } from '../shared/policy/words.js';
import { checkGrounded, vocabulary } from './grounding.js';
import { chargeTokens, estimateTokens } from './limits.js';
import { jsonCall } from './mistral.js';

const MAX_OUTPUT = 1500;
const MAX_WORDING_OUTPUT = 800;

const SYSTEM = `You tailor a few sentences of an AI use policy for a UK care organisation. The rest of the policy is fixed wording; you only write:

1. "purpose": two sentences saying what the policy is for, naming the organisation and the kind of service it runs. It must say the policy sets out which AI tools are approved, what they may and may not be used for, who checks the results, and what to do when something goes wrong.
2. "examples": for each task id given, one sentence (under 35 words) showing that task done safely in this organisation's kind of service. Each sentence says what AI does and what the person then checks, for example "AI drafts the advert from the manager's notes, and the manager checks it before it is posted." Describe people in everyday terms, such as "a care worker" or "a manager". Do not name any tool or product in the examples: which tools may be used for which tasks is decided elsewhere in the policy.

Rules:
- British English, plain and calm. No exclamation marks, no markdown, no brackets.
- Mention only the organisation name and service types you are given. Never invent names of people, places, products, organisations, laws or statistics. Use no numbers.
- Never suggest AI makes a decision about anyone's care, risk, eligibility or safeguarding.
- For tasks involving information about people, keep it clear that a person checks and corrects the draft.

Answer in JSON only, in exactly this shape:
{"purpose": "...", "examples": {"<task id>": "..."}}`;

/** Where each role answer appears in the policy, so the model can make it fit. */
const ROLE_SENTENCES: Record<(typeof ROLE_TEXT_SLOTS)[number], string[]> = {
  owner: ['___ keeps this list up to date.', 'Not sure? Ask ___ first.'],
  approver: [
    'No new AI tool starts until it has been approved by ___.',
    'Any other use needs agreement from ___ first.',
  ],
  dpLead: ['Ask ___ if you are not sure.', '___ decides whether it must be reported to the ICO.'],
  checker: ['___ checks a sample of AI-produced work every month.'],
  reportTo: ['If something goes wrong, tell ___ straight away.'],
};

const WORDING_SYSTEM = `You tidy a manager's typed answers so they fit into fixed sentences of an AI use policy for a UK care organisation. You never add facts; you only reword what they said.

1. "roles": for each role given, return
   - "phrase": what goes in the blank in every one of the sentences shown, reading naturally and grammatically. A single, singular noun phrase with no commas, such as "the Registered Manager", "your line manager" or "the board". The sentences speak to staff, so someone's own manager is "your line manager". Lower case unless a word is a title or name. Where the answer names two people with different parts (one reviews, another decides), the phrase names the one who decides.
   - "cell": a short label for a table of roles, under 60 characters, such as "Registered Manager" or "CEO reviews; the board decides".
   - If the answer says nobody holds the role yet (for example "no one right now" or "not decided"), return {"none": true} instead.
   If the answer is already a plain role, keep it: "Registered Manager" gives phrase "the Registered Manager" and cell "Registered Manager".
2. "redLines": if their own red lines are given, rewrite them as a list of clauses that each finish the sentence "AI must never be used ...", for example "to write to families after a death". Keep their meaning exactly, fix spelling and grammar, and keep everything they asked for, even where it overlaps the fixed rules.
3. "tasksOther": if other tasks are given, one tidy phrase listing them, lower case, no full stop, such as "drafting newsletters and meeting minutes".

Rules:
- British English. No markdown, no brackets, no quotation marks.
- Use only the words, names and roles in their answers. Never invent people, places, products, laws or numbers.
- Leave out anything not given.

Answer in JSON only, in exactly this shape:
{"roles": {"<role id>": {"phrase": "...", "cell": "..."}}, "redLines": ["..."], "tasksOther": "..."}`;

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
  const [main, wording] = await Promise.allSettled([tailorText(a), tailorWording(a)]);
  // Either half can fail on its own and leave the fixed wording in place. Only
  // when both fail does the page hear about it.
  if (main.status === 'rejected' && wording.status === 'rejected') throw main.reason;
  const snippets: Snippets = main.status === 'fulfilled' ? main.value.snippets : {};
  let rejected = main.status === 'fulfilled' ? main.value.rejected : 0;
  if (wording.status === 'fulfilled') {
    if (wording.value.wording) snippets.wording = wording.value.wording;
    rejected += wording.value.rejected;
  }
  return { snippets, rejected };
}

/** Everything they typed, and the tools they chose: the words a snippet may use. */
function answerVocabulary(a: Answers, extra: string[]): Set<string> {
  return vocabulary([
    ...Object.values(a)
      .flat()
      .filter((v): v is string => typeof v === 'string'),
    ...extra,
  ]);
}

async function tailorText(a: Answers): Promise<TailorResult> {
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

  const vocab = answerVocabulary(a, [...services, ...tools, ...tasks.map((t) => t.title)]);
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
      // No tool names at all: which tool may do which task is the register's
      // job. And it must say what the AI does, or it is not an example of AI use.
      if (checkGrounded(sentence, vocab, [], 260).ok && /\bAI\b/.test(sentence)) examples[t.id] = sentence;
      else rejected++;
    }
    snippets.examples = examples;
  }
  return { snippets, rejected };
}

const clean = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/[.\s]+$/, '') : '');

/** Typed answers put into the policy's sentences. Nothing to tidy means no call. */
export async function tailorWording(a: Answers): Promise<{ wording?: Wording; rejected: number }> {
  const roles = ROLE_TEXT_SLOTS.filter((id) => text(a, id) && !isNobody(text(a, id)));
  const redLines = text(a, 'redLines');
  const tasksOther = text(a, 'tasksOther');
  if (!roles.length && !redLines && !tasksOther) return { rejected: 0 };

  const brief = [
    roles.length
      ? `Roles:\n${roles
          .map(
            (id) =>
              `- ${id}: question "${getSlot(id)?.question ?? id}", answer "${text(a, id)}". Sentences: ${ROLE_SENTENCES[id].map((x) => `"${x}"`).join(' ')}`,
          )
          .join('\n')}`
      : '',
    redLines
      ? `Their own red lines: "${redLines}"\nThe fixed rules already say AI never decides anyone's care, risk, eligibility or whether to raise a safeguarding concern.`
      : '',
    tasksOther ? `Other tasks: "${tasksOther}"` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages = [
    { role: 'system' as const, content: WORDING_SYSTEM },
    { role: 'user' as const, content: brief },
  ];
  chargeTokens(estimateTokens(WORDING_SYSTEM.length + brief.length, MAX_WORDING_OUTPUT));
  const raw = await jsonCall<{ roles?: unknown; redLines?: unknown; tasksOther?: unknown }>(messages, {
    temperature: 0,
    maxTokens: MAX_WORDING_OUTPUT,
  });

  const vocab = answerVocabulary(a, []);
  const tools = list(a, 'tools')
    .filter((t) => t !== 'none' && t !== 'other')
    .map(toolName);
  const ok = (s: string, max: number) => checkGrounded(s, vocab, tools, max).ok;
  let rejected = 0;
  const wording: Wording = {};

  const rawRoles = raw.roles && typeof raw.roles === 'object' ? (raw.roles as Record<string, unknown>) : {};
  const out: Record<string, RoleWording> = {};
  for (const id of roles) {
    const r = rawRoles[id];
    if (!r || typeof r !== 'object') continue;
    const from = text(a, id);
    if ((r as { none?: unknown }).none === true) {
      out[id] = { from, none: true };
      continue;
    }
    // The same finishing touches as an untidied answer: "their line manager"
    // becomes "your line manager", a bare role gets "the".
    const phrase = rolePhrase(clean((r as { phrase?: unknown }).phrase));
    const cell = capitalise(clean((r as { cell?: unknown }).cell));
    // The phrase sits mid-sentence: no full stop inside it, and grounded.
    if (ok(phrase, 90) && ok(cell, 70) && !/[.!?,;]/.test(phrase)) out[id] = { from, phrase, cell };
    else rejected++;
  }
  if (Object.keys(out).length) wording.roles = out;

  if (redLines && Array.isArray(raw.redLines)) {
    const items = raw.redLines.map(clean).filter(Boolean);
    const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
    if (items.length && items.length <= 6 && items.every((x) => ok(x, 220))) {
      wording.redLines = { from: redLines, items: items.map(lower) };
    } else rejected++;
  }

  if (tasksOther) {
    const t = clean(raw.tasksOther);
    if (t && ok(t, 300)) wording.tasksOther = { from: tasksOther, text: t };
    else rejected++;
  }
  return { wording, rejected };
}
