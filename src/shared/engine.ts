// Moves the interview forward. Pure functions over the answers, so the browser
// and the server always agree on what comes next.

import {
  type Answers,
  type AnswerValue,
  getSlot,
  type Slot,
  TOPICS,
  type TopicId,
  UNSURE,
  visibleSlots,
} from './interview.js';

export const LIMITS = {
  /** Longest free-text message a person can send in one turn. */
  maxMessage: 1500,
  /** Messages of history sent with a turn; the answers carry everything older. */
  historyTurns: 6,
  maxAnswerText: 300,
};

/** The next question to ask, or null when the interview is complete. */
export function nextSlot(a: Answers): Slot | null {
  return visibleSlots(a).find((s) => a[s.id] === undefined) ?? null;
}

export interface TopicProgress {
  id: TopicId;
  title: string;
  state: 'done' | 'current' | 'todo';
}

export function progress(a: Answers): { done: number; total: number; topics: TopicProgress[] } {
  const slots = visibleSlots(a);
  const done = slots.filter((s) => a[s.id] !== undefined).length;
  const current = nextSlot(a)?.topic;
  const currentIndex = current ? TOPICS.findIndex((t) => t.id === current) : TOPICS.length;
  const topics = TOPICS.map(({ id, title }, i) => {
    const own = slots.filter((s) => s.topic === id);
    // A topic with no questions for these answers counts as done once the interview has passed it.
    const complete = own.length ? own.every((s) => a[s.id] !== undefined) : i < currentIndex;
    const state: TopicProgress['state'] = id === current ? 'current' : complete ? 'done' : 'todo';
    return { id, title, state };
  });
  return { done, total: slots.length, topics };
}

/**
 * Checks a value against a slot and returns it cleaned, or undefined if it
 * does not fit. Every value from the model or the browser goes through this.
 */
export function coerce(slot: Slot, raw: unknown): AnswerValue | undefined {
  if (raw === UNSURE) return UNSURE;
  const ids = new Set(slot.options?.map((o) => o.id));
  switch (slot.kind) {
    case 'choice':
      return typeof raw === 'string' && ids.has(raw) ? raw : undefined;
    case 'multi': {
      const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
      let picked = [...new Set(arr.filter((x): x is string => typeof x === 'string' && ids.has(x)))];
      // "None yet" cannot sit alongside a real choice.
      if (picked.length > 1) picked = picked.filter((x) => x !== 'none');
      return picked.length ? picked : undefined;
    }
    case 'text': {
      if (typeof raw !== 'string') return undefined;
      const t = raw
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, slot.maxLength ?? LIMITS.maxAnswerText);
      // "No, nothing else" to an optional question is a skip, not an answer to print.
      if (slot.optional && isNoAnswer(t)) return UNSURE;
      return t ? t : undefined;
    }
  }
}

const NO = /^(no|nope|none|nothing|nah|n\/?a|not really)\b/i;
const FILLER_WORDS = new Set(
  "that that's thats it it's its covers covered all for us me now thanks thank you good fine ok okay i think so far at the moment really else nothing we're were is are".split(
    ' ',
  ),
);

const wordsOf = (t: string) => t.toLowerCase().match(/[a-z0-9']+/g) ?? [];

/** "No", "Nothing else, thanks", "No, that covers it for us", but not "No AI for end of life care". */
export function isNoAnswer(t: string): boolean {
  const m = NO.exec(t.trim());
  return !!m && wordsOf(t.trim().slice(m[0].length)).every((w) => FILLER_WORDS.has(w));
}

const YES = new Set(['yes', 'yep', 'yeah', 'y', 'correct', 'we do', 'yes we do', 'we have']);
const NOS = new Set([
  'no',
  'nope',
  'nah',
  'n',
  'we do not',
  "we don't",
  'no we do not',
  "no we don't",
  'not yet',
]);
const UNSURES = new Set([
  'not sure',
  'unsure',
  "don't know",
  'dont know',
  'no idea',
  'i am not sure',
  "i'm not sure",
  'skip',
]);

/**
 * A typed answer that is just an option, "yes", "no" or "not sure" needs no
 * model: matched here, in the browser and on the server alike.
 */
export function matchOption(slot: Slot, typed: string): AnswerValue | undefined {
  const t = wordsOf(typed).join(' ');
  if (!t) return undefined;
  if (UNSURES.has(t)) return UNSURE;
  if (slot.kind !== 'choice') return undefined;
  const byLabel = slot.options?.find((o) => wordsOf(o.label).join(' ') === t || o.id === t);
  if (byLabel) return byLabel.id;
  const ids = new Set(slot.options?.map((o) => o.id));
  if (YES.has(t) && ids.has('yes')) return 'yes';
  if (NOS.has(t) && ids.has('no')) return 'no';
  return undefined;
}

/** Applies a patch of values, dropping anything that does not fit its slot. */
export function applyValues(a: Answers, values: Record<string, unknown>): Answers {
  const next = { ...a };
  // Tools first: plan slots only exist once their tool is chosen.
  const order = Object.keys(values).sort((x, y) => Number(y === 'tools') - Number(x === 'tools'));
  for (const id of order) {
    const slot = getSlot(id);
    if (!slot) continue;
    const v = coerce(slot, values[id]);
    if (v !== undefined) next[id] = v;
  }
  return next;
}

/** Keeps only answers to questions that still apply, e.g. after a tool is removed. */
export function prune(a: Answers): Answers {
  const keep = new Set(visibleSlots(a).map((s) => s.id));
  return Object.fromEntries(Object.entries(a).filter(([id]) => keep.has(id)));
}

export interface TurnRequest {
  answers: Answers;
  slot: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  message: string;
}

export interface TurnResponse {
  /** What the assistant says back. */
  reply: string;
  /** Values the model read from the message, already checked against their slots. */
  values: Answers;
  /** Options mentioned in passing for list questions still to come, to tick in advance. */
  suggested: Answers;
  /** True when the current question still needs an answer. */
  stay: boolean;
}
