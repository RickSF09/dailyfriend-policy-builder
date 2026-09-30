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
  /**
   * Typed answers put into policy wording. Each keeps the answer it was made
   * from (`from`), and is only used while that answer is unchanged.
   */
  wording?: Wording;
}

export type RoleWording =
  | {
      from: string;
      /** Fits mid-sentence: "Tell ___ straight away", "until it has been approved by ___". */
      phrase: string;
      /** Short, for the roles table. */
      cell: string;
    }
  /** The answer says nobody holds the role yet: the policy shows a gap. */
  | { from: string; none: true };

export interface Wording {
  roles?: Record<string, RoleWording>;
  /** Their own red lines, each finishing "AI must never be used …". */
  redLines?: { from: string; items: string[] };
  /** Their other tasks, as a phrase finishing "Also agreed, subject to the same rules: …". */
  tasksOther?: { from: string; text: string };
}

export const GAP = /\[TO DECIDE: [^\]]*\]/g;

/** Shown under the policy on screen and at the end of the Word document. */
export const DISCLAIMER =
  'Drafted from your answers with the DailyFriend AI policy builder, using wording based on published guidance from CQC, the ICO and DHSC. Read it, change anything that does not match how you actually work, and have it approved before you rely on it. It is not legal advice.';
