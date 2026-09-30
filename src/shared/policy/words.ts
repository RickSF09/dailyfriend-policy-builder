// Turning answers into phrases. Anything unanswered becomes a visible
// [TO DECIDE: ...] gap, never a guess.

import { HUB_URL, PAGES } from '../knowledge.generated.js';
import { type Answers, isNobody, isUnsure, list, text, toolName, UNSURE } from '../interview.js';
import type { Wording } from './types.js';

export const gap = (what: string) => `[TO DECIDE: ${what}]`;

/** "a", "a and b", "a, b and c". */
export function joinList(items: string[], word = 'and'): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ${word} ${items[items.length - 1]}`;
}

const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/London',
});

export const formatDate = (d: Date) => DATE.format(d);

export function addMonths(d: Date, months: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + months);
  return out;
}

export function reviewDate(a: Answers, today: Date): string {
  const months = Number(a.reviewMonths);
  return months ? formatDate(addMonths(today, months)) : gap('review date, no more than 12 months away');
}

const ROLE_WORD =
  /\b(manager|coordinator|co-ordinator|officer|director|directors|lead|leader|trustee|trustees|board|owner|chief|executive|deputy|supervisor|administrator|head|team|dpo|ceo|coo|cto|cfo|cio|nurse|chair)\b/i;

/** "Their line manager", "my manager": the policy speaks to staff, so it is "your line manager". */
const OWN_MANAGER =
  /^(their|his|her|your|my|own|each person'?s|the person'?s)\s+(own\s+)?((line\s+)?manager|supervisor|team leader)\b/i;

/** "Registered Manager" reads as "the Registered Manager"; a bare name reads as itself. */
export function rolePhrase(t: string): string {
  const own = OWN_MANAGER.exec(t);
  if (own) return `your ${own[3]!.toLowerCase()}${t.slice(own[0].length)}`;
  if (/^(the|our|a|an|my|their|each|every|any)\b/i.test(t)) {
    return t.charAt(0).toLowerCase() + t.slice(1);
  }
  return ROLE_WORD.test(t) ? `the ${t}` : t;
}

// Typed answers the model has put into policy wording (see server/tailor.ts)
// travel with the answers under these keys, so every clause picks them up.
// assemblePolicy() adds them after pruning, and only while the answer they
// were made from is unchanged.
const PHRASE = (id: string) => `~phrase:${id}`;
const CELL = (id: string) => `~cell:${id}`;
export const RED_LINES = '~redLines';
export const TASKS_OTHER = '~tasksOther';

export function withWording(a: Answers, w: Wording | undefined): Answers {
  if (!w) return a;
  const out = { ...a };
  for (const [id, r] of Object.entries(w.roles ?? {})) {
    if (text(a, id) !== r.from) continue;
    if ('none' in r) {
      out[id] = UNSURE;
      continue;
    }
    out[PHRASE(id)] = r.phrase;
    out[CELL(id)] = r.cell;
  }
  if (w.redLines && text(a, 'redLines') === w.redLines.from && w.redLines.items.length) {
    out[RED_LINES] = w.redLines.items;
  }
  if (w.tasksOther && text(a, 'tasksOther') === w.tasksOther.from) out[TASKS_OTHER] = w.tasksOther.text;
  return out;
}

/** A role answer, unless it says nobody holds the role yet. */
const role = (a: Answers, id: string) => {
  const t = text(a, id);
  return t && !isNobody(t) ? t : '';
};

/**
 * An answer that is more than a role ("As CEO I review it and the board
 * decides", "CEO reviews; the board decides") cannot go into a sentence as it
 * is. Without the model's wording, the sentence names the role from section 3
 * instead, and the roles table shows their words.
 */
const isPlainRole = (t: string) =>
  !/[;:]/.test(t) && !/\b(i|we|me|us)\b/i.test(t) && t.split(/\s+/).length <= 6;

const ROLE_NAME: Record<string, string> = {
  owner: 'the policy owner',
  approver: 'the person who approves new tools (section 3)',
  dpLead: 'the data protection lead',
  checker: 'the person who spot-checks AI output (section 3)',
  reportTo: 'the person named in section 3',
};

/** A role from a text answer, phrased for the middle of a sentence, or a gap describing it. */
export const who = (a: Answers, id: string, describe: string) => {
  const t = role(a, id);
  if (!t) return gap(describe);
  const tidied = text(a, PHRASE(id));
  if (tidied) return tidied;
  return isPlainRole(t) || !ROLE_NAME[id] ? rolePhrase(t) : ROLE_NAME[id];
};

/** The same, at the start of a sentence. */
export const Who = (a: Answers, id: string, describe: string) => capitalise(who(a, id, describe));

/** A role for table cells: as typed, tidied where the model has done so. */
export const whoCell = (a: Answers, id: string, describe: string) => {
  const t = role(a, id);
  if (!t) return gap(describe);
  return text(a, CELL(id)) || t;
};

export const capitalise = (s: string) => (s.startsWith('[') ? s : s.charAt(0).toUpperCase() + s.slice(1));

export const orgName = (a: Answers) => text(a, 'orgName') || gap('organisation name');

export function checkRate(a: Answers): string {
  const rates: Record<string, string> = {
    weekly: 'every week',
    monthly: 'every month',
    quarterly: 'every three months',
  };
  return rates[String(a.checkRate)] ?? gap('how often');
}

export function reportHow(a: Answers): string {
  const how: Record<string, string> = {
    person: 'in person or by phone',
    email: 'by email',
    form: 'using our incident form',
    any: 'in person, by phone, by email or on our incident form',
  };
  return how[String(a.reportHow)] ?? '';
}

export function signoffBy(a: Answers): string {
  const by: Record<string, string> = {
    trustees: 'the board of trustees',
    directors: 'the directors',
    owner: 'the owner',
    manager: 'the registered manager',
  };
  return by[String(a.signoffBy)] ?? gap('who signs the policy off');
}

export function workforce(a: Answers): string {
  const names: Record<string, string> = {
    employed: 'employed staff',
    bank: 'bank staff',
    agency: 'agency staff',
    volunteers: 'volunteers',
    board: 'trustees and directors',
  };
  const picked = list(a, 'workforce').map((w) => names[w] ?? w);
  return picked.length ? joinList(picked) : `everyone who works or volunteers for ${orgName(a)}`;
}

// ---------------------------------------------------------------------------
// Regulators and law, by nation
// ---------------------------------------------------------------------------

const REGULATOR: Record<string, string> = {
  england: 'the Care Quality Commission (CQC)',
  wales: 'Care Inspectorate Wales (CIW)',
  scotland: 'the Care Inspectorate',
  ni: 'the Regulation and Quality Improvement Authority (RQIA)',
};

export function regulators(a: Answers): string {
  const names = list(a, 'nations')
    .map((n) => REGULATOR[n])
    .filter((x): x is string => !!x);
  return names.length ? joinList(names) : gap('our care regulator');
}

export const inEngland = (a: Answers) => list(a, 'nations').includes('england');

/** The capacity law for each nation this organisation works in. */
export function capacityLaw(a: Answers): string {
  const laws = new Set<string>();
  for (const n of list(a, 'nations')) {
    if (n === 'england' || n === 'wales') laws.add('the Mental Capacity Act 2005');
    if (n === 'scotland') laws.add('the Adults with Incapacity (Scotland) Act 2000');
    if (n === 'ni') laws.add('mental capacity law in Northern Ireland');
  }
  return laws.size ? joinList([...laws]) : 'mental capacity law';
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export interface ToolRow {
  id: string;
  name: string;
  plan: string;
  /** Has the organisation agreed to it? "unknown" when that question was not answered. */
  agreed: 'yes' | 'no' | 'unknown';
}

/** Every tool named in the answers, with its plan answer. "other" uses their own wording. */
export function chosenTools(a: Answers): ToolRow[] {
  const agreed = list(a, 'agreed');
  return list(a, 'tools')
    .filter((t) => t !== 'none')
    .map((id) => ({
      id,
      name: id === 'other' ? text(a, 'toolsOther') || gap('name of the other tool') : toolName(id),
      plan: isUnsure(a[`plan:${id}`]) ? 'unsure' : String(a[`plan:${id}`] ?? 'unsure'),
      agreed: agreed.includes(id) ? 'yes' : agreed.length ? 'no' : 'unknown',
    }));
}

/** Tools staff may use now: agreed, and on an account that could be approved. */
export const usableTools = (a: Answers) =>
  chosenTools(a).filter((r) => r.agreed === 'yes' && !isPersonalPlan(r.plan) && r.plan !== 'unsure');

export const isPersonalPlan = (plan: string) => plan === 'free' || plan === 'personal-paid';

/** A link to a hub page, only if the page exists, so the plan never links to a 404. */
export function hubLink(path: string): { label: string; url: string } | undefined {
  const title = PAGES[path];
  return title ? { label: title, url: `${HUB_URL}${path}` } : undefined;
}
