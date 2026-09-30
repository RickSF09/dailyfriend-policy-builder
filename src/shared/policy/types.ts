// The finished policy as data. The browser renders it on screen and turns the
// same structure into a Word document, so the two cannot drift apart.
//
// Text may contain **bold** and [TO DECIDE: ...] markers; both renderers
// understand them.

export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'heading'; text: string };

export interface Section {
  id: string;
  title: string;
  blocks: Block[];
}

export interface Action {
  id: string;
  priority: 'now' | 'soon' | 'later';
  title: string;
  why: string;
  link?: { label: string; url: string };
}

export interface PolicyDoc {
  orgName: string;
  /** Label and value pairs under the title: version, dates, owner. */
  meta: [string, string][];
  sections: Section[];
  summary: { title: string; blocks: Block[] };
  actions: Action[];
  /** How many [TO DECIDE] gaps remain, across everything. */
  gaps: number;
}

/**
 * Wording the model tailors to this organisation. Every field is optional:
 * without it the policy uses the default wording, so a failed or rejected
 * model call never blocks a policy.
 */
export interface Snippets {
  purpose?: string;
  /** Use id → one sentence showing that use in this organisation. */
  examples?: Record<string, string>;
}

export const GAP = /\[TO DECIDE: [^\]]*\]/g;

/** Shown under the policy on screen and at the end of the Word document. */
export const DISCLAIMER =
  'Drafted from your answers with the DailyFriend AI policy builder, using wording based on published guidance from CQC, the ICO and DHSC. Read it, change anything that does not match how you actually work, and have it approved before you rely on it. It is not legal advice.';
