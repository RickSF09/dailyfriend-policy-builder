// End-to-end check of the typed-answer path. For each persona, a model plays
// the manager and types every answer in its own words (the hardest case: real
// people mostly tap). Each message goes through the real runTurn, and the
// recorded answers are compared with what the persona should have given.
//
//   npm run eval                       all personas
//   npm run eval -- --only=wales-provider
//
// Needs MISTRAL_API_KEY. About 50 model calls per persona; a full run was
// roughly 280k tokens (September 2026), most of them the simulated manager.
//
// Launch gate: at least 85% of answers match, every persona finishes within 45
// turns. The simulated manager is itself a model and does not always stick to
// its brief (it says "a mix" when the brief says Plus, or adds a tool), so a
// mismatch is not always an extraction error: read eval/out/transcripts.txt
// before changing prompts. In September 2026 runs scored 87–89%, and every
// remaining mismatch reviewed was the simulator answering off-brief.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyValues, LIMITS, nextSlot, prune } from '../src/shared/engine.js';
import { type Answers, type AnswerValue, type Slot, UNSURE, visibleSlots } from '../src/shared/interview.js';
import { assemblePolicy } from '../src/shared/policy/assemble.js';
import { jsonCall, tokenUsage } from '../src/server/mistral.js';
import { runTailor } from '../src/server/tailor.js';
import { runTurn } from '../src/server/turn.js';
import { type Persona, PERSONAS } from './personas.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);
const MAX_TURNS = 45;

async function simulate(p: Persona, slot: Slot, lastReply: string): Promise<string> {
  const options = slot.options?.map((o) => o.label).join('; ');
  const out = await jsonCall<{ message?: string }>(
    [
      {
        role: 'system',
        content: `You are role-playing a busy manager at a UK care organisation, filling in an AI policy tool by typing short answers. Stay in character. ${p.brief}\n\nAnswer only from this brief, in one or two casual sentences, the way a real person types. Do not copy the option wording exactly, and do not add facts the brief does not give. If the brief does not cover the question, say you are not sure. Reply in JSON: {"message": "..."}`,
      },
      {
        role: 'user',
        content: `${lastReply ? `The tool said: "${lastReply}"\n` : ''}Question: ${slot.question}${options ? `\n(Options shown: ${options})` : ''}`,
      },
    ],
    { temperature: 0.4, maxTokens: 200 },
  );
  return (out.message ?? 'not sure').slice(0, LIMITS.maxMessage);
}

function same(expected: AnswerValue, got: AnswerValue | undefined): boolean {
  if (got === undefined) return false;
  if (Array.isArray(expected) || Array.isArray(got)) {
    const a = [...(Array.isArray(expected) ? expected : [expected])].sort();
    const b = [...(Array.isArray(got) ? got : [got])].sort();
    return JSON.stringify(a) === JSON.stringify(b);
  }
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  return expected === got || (!!norm(expected) && norm(got).includes(norm(expected)));
}

async function runPersona(p: Persona) {
  let answers: Answers = {};
  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  let turns = 0;
  let stuck = 0;
  let lastReply = '';
  let lastSlot = '';
  const transcript: string[] = [];

  for (let slot = nextSlot(answers); slot && turns < MAX_TURNS; slot = nextSlot(answers)) {
    stuck = slot.id === lastSlot ? stuck + 1 : 0;
    lastSlot = slot.id;
    if (stuck >= 2) {
      // A real person would tap "Not sure" at this point.
      answers = prune(applyValues(answers, { [slot.id]: UNSURE }));
      continue;
    }
    const message = await simulate(p, slot, lastReply);
    const res = await runTurn({
      answers,
      slot: slot.id,
      history: history.slice(-LIMITS.historyTurns),
      message,
    });
    history.push(
      { role: 'assistant', content: slot.question },
      { role: 'user', content: message },
      { role: 'assistant', content: res.reply },
    );
    transcript.push(
      `[${slot.id}] Q: ${slot.question}`,
      `  A: ${message}`,
      `  → ${JSON.stringify(res.values)} ${res.reply}`,
    );
    lastReply = res.reply;
    answers = prune(applyValues(answers, res.values));
    turns++;
  }

  const expectedSlots = visibleSlots(p.answers).filter((s) => p.answers[s.id] !== undefined);
  const wrong = expectedSlots
    .filter((s) => !same(p.answers[s.id]!, answers[s.id]))
    .map((s) => ({ slot: s.id, expected: p.answers[s.id], got: answers[s.id] ?? null }));
  const { rejected } = await runTailor(answers);
  const doc = assemblePolicy(answers);
  const actions = doc.actions.map((a) => a.id);
  const missingActions = p.expect.actions.filter((id) => !actions.includes(id));

  return {
    id: p.id,
    turns,
    finished: nextSlot(answers) === null,
    accuracy: 1 - wrong.length / expectedSlots.length,
    wrong,
    tailorRejected: rejected,
    missingActions,
    gaps: doc.gaps,
    transcript,
  };
}

const chosen = args.only ? PERSONAS.filter((p) => p.id === args.only) : PERSONAS;
const results = [];
for (const p of chosen) {
  process.stdout.write(`${p.id} … `);
  const r = await runPersona(p);
  results.push(r);
  console.log(
    `${r.turns} turns, ${(r.accuracy * 100).toFixed(0)}% right, ${r.tailorRejected} tailored sentences rejected${r.finished ? '' : ', DID NOT FINISH'}`,
  );
  for (const w of r.wrong)
    console.log(`    ${w.slot}: expected ${JSON.stringify(w.expected)}, got ${JSON.stringify(w.got)}`);
  if (r.missingActions.length) console.log(`    missing actions: ${r.missingActions.join(', ')}`);
}

const accuracy = results.reduce((n, r) => n + r.accuracy, 0) / results.length;
const pass = accuracy >= 0.85 && results.every((r) => r.finished && r.turns <= MAX_TURNS);
console.log(
  `\nOverall ${(accuracy * 100).toFixed(1)}% right. ${tokenUsage.calls} calls, ${tokenUsage.prompt} prompt + ${tokenUsage.completion} completion tokens (includes the simulated manager). ${pass ? 'PASS' : 'FAIL'}`,
);

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'eval.json'), JSON.stringify({ results, tokenUsage }, null, 2));
fs.writeFileSync(
  path.join(outDir, 'transcripts.txt'),
  results.map((r) => `## ${r.id}\n${r.transcript.join('\n')}`).join('\n\n'),
);
if (!pass) process.exitCode = 1;
