// Turning answers into phrases. Anything unanswered becomes a visible
// [TO DECIDE: ...] gap, never a guess.

import { HUB_URL, PAGES } from '../knowledge.generated.js';
import { type Answers, isUnsure, list, text, toolName } from '../interview.js';

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
  /\b(manager|coordinator|co-ordinator|officer|director|directors|lead|leader|trustee|trustees|board|owner|chief|executive|deputy|supervisor|administrator|head|team|dpo|ceo|coo|nurse|chair)\b/i;

/** "Registered Manager" reads as "the Registered Manager"; a bare name reads as itself. */
export function rolePhrase(t: string): string {
  if (/^(the|our|a|an|my|their|each|every|any)\b/i.test(t)) return t;
  return ROLE_WORD.test(t) ? `the ${t}` : t;
}

/** A role from a text answer, phrased for the middle of a sentence, or a gap describing it. */
export const who = (a: Answers, id: string, describe: string) => {
  const t = text(a, id);
  return t ? rolePhrase(t) : gap(describe);
};

/** The same, at the start of a sentence. */
export const Who = (a: Answers, id: string, describe: string) => capitalise(who(a, id, describe));

/** A role as typed, for table cells. */
export const whoCell = (a: Answers, id: string, describe: string) => text(a, id) || gap(describe);

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
}

/** Every tool named in the answers, with its plan answer. "other" uses their own wording. */
export function chosenTools(a: Answers): ToolRow[] {
  return list(a, 'tools')
    .filter((t) => t !== 'none')
    .map((id) => ({
      id,
      name: id === 'other' ? text(a, 'toolsOther') || gap('name of the other tool') : toolName(id),
      plan: isUnsure(a[`plan:${id}`]) ? 'unsure' : String(a[`plan:${id}`] ?? 'unsure'),
    }));
}

export const isPersonalPlan = (plan: string) => plan === 'free' || plan === 'personal-paid';

/** A link to a hub page, only if the page exists, so the plan never links to a 404. */
export function hubLink(path: string): { label: string; url: string } | undefined {
  const title = PAGES[path];
  return title ? { label: title, url: `${HUB_URL}${path}` } : undefined;
}
