// One typed answer: ask the model what it says, then keep only values that
// fit the questions it was allowed to answer.

import {
  applyValues,
  coerce,
  matchOption,
  prune,
  type TurnRequest,
  type TurnResponse,
} from '../shared/engine.js';
import { type Answers, getSlot, list, type Slot, visibleSlots } from '../shared/interview.js';
import { UserFacingError } from './errors.js';
import { chargeTokens, estimateTokens } from './limits.js';
import { type ChatMessage, jsonCall } from './mistral.js';
import { TURN_SYSTEM } from './prompts/turn.js';

const MAX_OUTPUT = 600;
const MAX_REPLY = 700;

function describe(slot: Slot): string {
  const options = slot.options?.map((o) => `"${o.id}" = ${o.label}`).join('; ');
  return `${slot.id} (${slot.kind}): ${slot.question}${options ? ` Options: ${options}.` : ''}`;
}

/** The answers so far, so the reply can make sense of short answers like "same as before". */
function known(a: Answers): string {
  const lines = visibleSlots(a)
    .filter((s) => a[s.id] !== undefined)
    .map((s) => `${s.id}: ${JSON.stringify(a[s.id])}`);
  return lines.length ? lines.join('\n') : '(none yet)';
}

/**
 * Which questions this message may answer. Multi-choice questions other than
 * the current one are left for the page to ask, so a passing mention of one
 * tool never skips the whole list of tools.
 */
function allowedIds(current: Slot, a: Answers): Set<string> {
  const ids = new Set([current.id]);
  if (current.options?.some((o) => o.id === 'other')) ids.add(`${current.id}Other`);
  for (const s of visibleSlots(a)) {
    if (a[s.id] === undefined && s.kind !== 'multi' && !s.askDirectly) ids.add(s.id);
  }
  return ids;
}

const RISK = /data processing agreement|personal (plan|account)|trains? (its|on)/i;
const ACCOUNT_WORDS = /\b(accounts?|plans?|personal|free|paid|business|team|enterprise|pro|plus|subscriptions?)\b/i;

/**
 * Rules the model does not always keep, enforced here:
 *  - once the answer is recorded, the page asks the next question, so a
 *    question in the reply would be asked twice;
 *  - a risk is only mentioned when this message mentions an account or plan, and
 *    never again once an earlier reply has mentioned it.
 */
export function tidyReply(
  reply: string,
  message: string,
  history: { role: string; content: string }[],
  answered: boolean,
): string {
  const earlier = history.filter((m) => m.role === 'assistant').map((m) => m.content);
  // The risk is about the account, not the tool: "claude we're still thinking
  // about" is no reason to warn again, and the first warning may be older
  // than the history the page sends.
  const mentionsAccount = ACCOUNT_WORDS.test(message);
  const sentences = reply.match(/[^.!?]+[.!?]*\s*/g) ?? [];
  const kept = sentences.filter((s) => {
    if (answered && s.trim().endsWith('?')) return false;
    if (!RISK.test(s)) return true;
    if (!mentionsAccount) return false;
    // Personal accounts and agreements are one point, however it is worded.
    return !earlier.some((e) => RISK.test(e));
  });
  return kept.join('').trim();
}

export async function runTurn(req: TurnRequest): Promise<TurnResponse> {
  const answers = prune(req.answers);
  // The visible version, so the model sees the question as the person saw it.
  const current = visibleSlots(answers).find((s) => s.id === req.slot);
  if (!current || answers[current.id] !== undefined) {
    throw new UserFacingError('That question is no longer open. Please reload the page.');
  }
  const direct = matchOption(current, req.message);
  if (direct !== undefined) {
    return { reply: 'Noted.', values: { [current.id]: direct }, suggested: {}, stay: false };
  }

  const others = visibleSlots(answers).filter(
    (s) => s.id !== current.id && answers[s.id] === undefined && !s.askDirectly,
  );

  const context = [
    `Current question: ${describe(current)}`,
    others.length ? `Other open questions:\n${others.map((s) => `- ${describe(s)}`).join('\n')}` : '',
    `Answers so far:\n${known(answers)}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: TURN_SYSTEM },
    ...req.history.map((m) => ({ role: m.role, content: m.content })),
    {
      role: 'user',
      content: `<context>\n${context}\n</context>\n\n<their message>\n${req.message}\n</their message>`,
    },
  ];

  chargeTokens(
    estimateTokens(
      messages.reduce((n, m) => n + m.content.length, 0),
      MAX_OUTPUT,
    ),
  );
  const raw = await jsonCall<{ values?: unknown; stay?: unknown; reply?: unknown }>(messages, {
    temperature: 0.2,
    maxTokens: MAX_OUTPUT,
  });

  // Keep only values for questions this message was allowed to answer.
  const allowed = allowedIds(current, answers);
  const proposed =
    raw.values && typeof raw.values === 'object' ? (raw.values as Record<string, unknown>) : {};
  const tools = Array.isArray(proposed.tools) ? proposed.tools : list(answers, 'tools');
  const filtered: Record<string, unknown> = {};
  for (const [id, v] of Object.entries(proposed)) {
    const plan = /^plan:(.+)$/.exec(id)?.[1];
    if (allowed.has(id) || (plan && tools.includes(plan))) filtered[id] = v;
  }
  const merged = prune(applyValues(answers, filtered));
  const values: Answers = {};
  for (const [id, v] of Object.entries(merged)) {
    if (JSON.stringify(answers[id]) !== JSON.stringify(v) && getSlot(id)) values[id] = v;
  }

  // Passing mentions for list questions are not answers, but the page ticks
  // them in advance when it gets to that question.
  const suggested: Answers = {};
  for (const [id, v] of Object.entries(proposed)) {
    const slot = getSlot(id);
    if (!slot || slot.kind !== 'multi' || filtered[id] !== undefined || merged[id] !== undefined) continue;
    const clean = coerce(slot, v);
    if (Array.isArray(clean)) suggested[id] = clean;
  }

  const answered = values[current.id] !== undefined;
  let reply = tidyReply(
    typeof raw.reply === 'string' ? raw.reply.trim().slice(0, MAX_REPLY) : '',
    req.message,
    req.history,
    answered,
  );
  if (!reply)
    reply = answered ? 'Thank you.' : 'Sorry, I did not quite follow. Could you put that another way?';
  return { reply, values, suggested, stay: !answered };
}
