// A model-written sentence may only mention what the person told us. Before a
// snippet is used, every capitalised word (other than at the start of a
// sentence) and every number in it must appear in their answers or in a short
// list of expected terms; any tool from the directory they did not choose is a
// rejection. The same idea as the anonymiser's rule that every finding must be
// found verbatim in the document. A rejected snippet falls back to the fixed
// wording, so this can afford to be strict.

import { TOOLS } from '../shared/knowledge.generated.js';

const ALWAYS = [
  'AI',
  'UK',
  'GDPR',
  'CQC',
  'ICO',
  'DPIA',
  'DPA',
  'NHS',
  'I',
  'English',
  'Easy',
  'Read',
  'Registered',
  'Manager',
  'England',
  'Wales',
  'Scotland',
  'Northern',
  'Ireland',
];

function words(s: string): string[] {
  // "CEO's" is the word "CEO".
  return (
    s
      .toLowerCase()
      .replace(/['’]s\b/g, '')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

export function vocabulary(sources: string[]): Set<string> {
  return new Set([...ALWAYS, ...sources].flatMap(words));
}

export interface GroundingResult {
  ok: boolean;
  reason?: string;
}

export function checkGrounded(
  snippet: string,
  vocab: Set<string>,
  chosenToolNames: string[],
  maxLength: number,
): GroundingResult {
  if (!snippet.trim()) return { ok: false, reason: 'empty' };
  if (snippet.length > maxLength) return { ok: false, reason: 'too long' };
  // Markers the renderers treat specially, and anything that looks like markup.
  if (/[[\]*<>#_`]/.test(snippet)) return { ok: false, reason: 'markup' };

  const lower = snippet.toLowerCase();
  const products = [...TOOLS.map((t) => t.name), 'Copilot', 'Gemini', 'Microsoft 365', 'Google Workspace'];
  for (const name of products) {
    if (lower.includes(name.toLowerCase()) && !chosenToolNames.some((c) => c.includes(name))) {
      return { ok: false, reason: `unchosen tool ${name}` };
    }
  }

  for (const n of snippet.match(/\d+/g) ?? []) {
    if (!vocab.has(n)) return { ok: false, reason: `number ${n}` };
  }

  // Capitalised words that do not start a sentence: names of people, places,
  // products or organisations. Each one must come from the answers.
  const sentences = snippet.split(/(?<=[.!?:;])\s+/);
  for (const sentence of sentences) {
    const tokens = sentence.match(/[\p{L}][\p{L}'’-]*/gu) ?? [];
    for (const token of tokens.slice(1)) {
      if (!/^\p{Lu}/u.test(token)) continue;
      const parts = words(token);
      if (!parts.every((p) => vocab.has(p))) return { ok: false, reason: `unknown name ${token}` };
    }
  }
  return { ok: true };
}
