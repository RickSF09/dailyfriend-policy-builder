// Moving a session forward: recording answers and asking the next question.

import { applyValues, nextSlot, prune } from '../shared/engine';
import type { Answers, Slot } from '../shared/interview';
import type { Message, Session } from './store';

export const ask = (slot: Slot): Message => ({ role: 'assistant', text: slot.question, slot: slot.id });

/**
 * Records values from one turn and moves to the next question. When the
 * model's reply has already asked the same question again (`stayedOn`), the
 * question is not repeated.
 */
export function commit(s: Session, values: Answers, said: Message[], stayedOn?: string): Session {
  const answers = prune(applyValues(s.answers, values));
  const changed = Object.keys(answers).filter(
    (k) => JSON.stringify(answers[k]) !== JSON.stringify(s.answers[k]),
  );
  const messages = [...s.messages, ...said];
  const next = nextSlot(answers);
  const last = messages[messages.length - 1];
  const alreadyAsked = (last?.role === 'assistant' && last.slot === next?.id) || next?.id === stayedOn;
  if (next && !alreadyAsked) messages.push(ask(next));
  if (!next) {
    messages.push({
      role: 'assistant',
      text: 'That is everything I need. Check your answers on the next screen, then build the policy.',
    });
  }
  return { ...s, answers, messages, turns: [...s.turns, changed], phase: next ? 'interview' : 'review' };
}

/** Starts the interview, or resumes one. */
export function begin(s: Session): Session {
  const next = nextSlot(s.answers);
  if (!next) return { ...s, phase: 'review' };
  const last = s.messages[s.messages.length - 1];
  const messages =
    last?.role === 'assistant' && last.slot === next.id
      ? s.messages
      : [
          ...s.messages,
          ...(s.messages.length
            ? []
            : [
                {
                  role: 'assistant' as const,
                  text: 'I will ask about your organisation and how AI is used there, one question at a time. Tap an answer, or type in your own words. It takes about fifteen minutes.',
                },
              ]),
          ask(next),
        ];
  return { ...s, phase: 'interview', messages };
}
