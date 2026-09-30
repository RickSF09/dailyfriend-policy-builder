// The interview. Questions come from the engine; tapping an option answers
// without any server call. Typed answers go to the model, which reads them
// and replies. Every typed answer is checked for personal identifiers first.

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Check, CircleHelp, Loader2, RotateCcw, ShieldAlert } from 'lucide-react';
import { LIMITS, matchOption, nextSlot, progress } from '../shared/engine';
import { list, type Option, type Slot, text, UNSURE } from '../shared/interview';
import { findPii, type PiiType } from '../shared/pii';
import { sendTurn } from './client';
import { ask, commit } from './session';
import type { Message, Session } from './store';

type Update = (fn: (s: Session) => Session) => void;

const WITH_ARTICLE: Record<PiiType, string> = {
  'NHS number': 'an NHS number',
  'phone number': 'a phone number',
  'email address': 'an email address',
  'National Insurance number': 'a National Insurance number',
  postcode: 'a postcode',
  'date of birth': 'a date of birth',
};

/** A reply that ends on a question has asked something again, so the page need not. */
const asksAgain = (reply: string) => /\?\s*$/.test(reply);

function optionLabel(slot: Slot, id: string): string {
  if (id === UNSURE) return slot.optional ? 'Skip' : 'Not sure';
  return slot.options?.find((o) => o.id === id)?.label ?? id;
}

/** Short direct answers to text questions need no model call. */
function isPlainTextAnswer(slot: Slot, t: string): boolean {
  return (
    slot.kind === 'text' &&
    t.length <= 80 &&
    !t.includes('?') &&
    !/\b(not sure|don'?t know|no idea|skip|unsure|same as)\b/i.test(t)
  );
}

export function Chat({ session, update }: { session: Session; update: Update }) {
  const slot = nextSlot(session.answers);
  const [draft, setDraft] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [piiWarning, setPiiWarning] = useState<PiiType[] | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [session.messages.length, pending]);
  // A new question starts with nothing picked and the help closed.
  useEffect(() => {
    setPicked(slot ? list(session.suggested ?? {}, slot.id) : []);
    setShowHelp(false);
    // Text questions are answered by typing, so the box is ready for it.
    if (slot?.kind === 'text') inputRef.current?.focus({ preventScroll: true });
    // Only when the question changes; later suggestions must not undo their ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot?.id, slot?.kind]);

  const prog = useMemo(() => progress(session.answers), [session.answers]);

  if (!slot) return null;

  function answerWith(value: string | string[], label: string, option?: Option) {
    if (!slot) return;
    const said: Message[] = [{ role: 'user', text: label }];
    if (option?.ack) said.push({ role: 'assistant', text: option.ack });
    update((s) => commit(s, { [slot.id]: value }, said));
  }

  function suggestionValue(sugg: string): string {
    if (sugg === '$owner') return text(session.answers, 'owner');
    if (sugg === '$me') return text(session.answers, 'yourRole');
    return sugg;
  }

  function suggestionLabel(sugg: string): string {
    if (sugg === '$owner') return `Same as policy owner (${text(session.answers, 'owner')})`;
    if (sugg === '$me') return `Me (${text(session.answers, 'yourRole')})`;
    return sugg;
  }

  function chooseSuggestion(sugg: string) {
    const value = suggestionValue(sugg);
    if (value) answerWith(value, value);
  }

  async function send(confirmed = false) {
    if (!slot) return;
    const message = draft.trim().slice(0, LIMITS.maxMessage);
    if (!message || pending) return;
    const hits = findPii(message);
    if (hits.length && !confirmed) {
      setPiiWarning([...new Set(hits.map((h) => h.type))]);
      return;
    }
    setPiiWarning(null);
    setDraft('');

    const direct = matchOption(slot, message);
    if (direct !== undefined) {
      answerWith(
        direct,
        message,
        slot.options?.find((o) => o.id === direct),
      );
      return;
    }
    if (isPlainTextAnswer(slot, message)) {
      answerWith(message, message);
      return;
    }

    const history = session.messages
      .slice(-LIMITS.historyTurns)
      .map((m) => ({ role: m.role, content: m.text }));
    update((s) => ({ ...s, messages: [...s.messages, { role: 'user', text: message }] }));
    setPending(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await sendTurn({ answers: session.answers, slot: slot.id, history, message }, ctrl.signal);
      update((s) => ({
        // Only skip repeating the question if the reply actually asked it again.
        ...commit(
          s,
          res.values,
          [{ role: 'assistant', text: res.reply }],
          res.stay && asksAgain(res.reply) ? slot.id : undefined,
        ),
        suggested: { ...s.suggested, ...res.suggested },
      }));
    } catch (e) {
      if (ctrl.signal.aborted) return;
      update((s) => ({
        ...s,
        messages: [
          ...s.messages,
          {
            role: 'assistant',
            text: `${e instanceof Error ? e.message : 'Something went wrong.'} You can tap one of the answers below instead.`,
          },
        ],
      }));
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  }

  function undo() {
    update((s) => {
      const turns = [...s.turns];
      let ids: string[] = [];
      while (turns.length && !ids.length) ids = turns.pop() ?? [];
      if (!ids.length) return s;
      const answers = { ...s.answers };
      for (const id of ids) delete answers[id];
      const next = nextSlot(answers);
      return {
        ...s,
        answers,
        turns,
        messages: [
          ...s.messages,
          { role: 'assistant', text: 'No problem, let’s go back.' },
          ...(next ? [ask(next)] : []),
        ],
      };
    });
  }

  const canUndo = session.turns.some((t) => t.length);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_15rem]">
      <section aria-label="Interview" className="min-w-0">
        <ol className="space-y-3" aria-live="polite" aria-relevant="additions">
          {session.messages.map((m, i) => (
            <li key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex'}>
              <p
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-brand text-white rounded-br-md'
                    : m.slot
                      ? 'bg-white border border-line rounded-bl-md font-medium'
                      : 'bg-white border border-line rounded-bl-md text-ink/90'
                }`}
              >
                {m.text}
              </p>
            </li>
          ))}
          {pending && (
            <li className="flex" aria-label="Reading your answer">
              <p className="rounded-2xl rounded-bl-md bg-white border border-line px-4 py-3 flex gap-1">
                <span className="typing-dot size-2 rounded-full bg-muted" />
                <span className="typing-dot size-2 rounded-full bg-muted" />
                <span className="typing-dot size-2 rounded-full bg-muted" />
              </p>
            </li>
          )}
        </ol>

        <div className="mt-5 rounded-2xl border border-line bg-white p-4 shadow-sm">
          {slot.help && (
            <div className="mb-3">
              <button
                type="button"
                onClick={() => setShowHelp((v) => !v)}
                aria-expanded={showHelp}
                className="inline-flex items-center gap-1.5 text-sm text-brand hover:underline"
              >
                <CircleHelp className="size-4" aria-hidden="true" />
                Why we ask
              </button>
              {showHelp && <p className="mt-2 text-sm text-muted leading-relaxed">{slot.help}</p>}
            </div>
          )}

          {slot.kind === 'choice' && (
            <div className="flex flex-wrap gap-2">
              {slot.options?.map((o) => (
                <Chip key={o.id} disabled={pending} onClick={() => answerWith(o.id, o.label, o)}>
                  {o.label}
                </Chip>
              ))}
              <Chip quiet disabled={pending} onClick={() => answerWith(UNSURE, optionLabel(slot, UNSURE))}>
                {optionLabel(slot, UNSURE)}
              </Chip>
            </div>
          )}

          {slot.kind === 'multi' && (
            <div>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Pick all that apply">
                {slot.options?.map((o) => {
                  const on = picked.includes(o.id);
                  return (
                    <Chip
                      key={o.id}
                      pressed={on}
                      disabled={pending}
                      onClick={() =>
                        setPicked((p) =>
                          on
                            ? p.filter((x) => x !== o.id)
                            : o.id === 'none'
                              ? ['none']
                              : [...p.filter((x) => x !== 'none'), o.id],
                        )
                      }
                    >
                      {on && <Check className="size-4" aria-hidden="true" />}
                      {o.label}
                    </Chip>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!picked.length || pending}
                  onClick={() => answerWith(picked, picked.map((p) => optionLabel(slot, p)).join(', '))}
                  className="rounded-full bg-brand px-4 py-2 font-semibold text-white disabled:opacity-40 hover:bg-brand-dark"
                >
                  Continue
                </button>
                <Chip quiet disabled={pending} onClick={() => answerWith(UNSURE, optionLabel(slot, UNSURE))}>
                  {optionLabel(slot, UNSURE)}
                </Chip>
              </div>
            </div>
          )}

          {slot.kind === 'text' && (
            <div className="flex flex-wrap gap-2">
              {slot.suggestions
                // Drop "Me" or "Same as owner" when there is nothing to fill them with,
                // and any fixed suggestion that just repeats one of them.
                ?.filter(
                  (sg, i, all) =>
                    suggestionValue(sg) &&
                    all.findIndex((x) => suggestionValue(x) === suggestionValue(sg)) === i,
                )
                .map((sg) => (
                  <Chip key={sg} disabled={pending} onClick={() => chooseSuggestion(sg)}>
                    {suggestionLabel(sg)}
                  </Chip>
                ))}
              <Chip quiet disabled={pending} onClick={() => answerWith(UNSURE, optionLabel(slot, UNSURE))}>
                {optionLabel(slot, UNSURE)}
              </Chip>
            </div>
          )}

          {piiWarning && (
            <div role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">
              <p className="flex items-start gap-2 font-semibold">
                <ShieldAlert className="size-5 shrink-0 text-amber-600" aria-hidden="true" />
                That looks like it contains {piiWarning.map((t) => WITH_ARTICLE[t]).join(' and ')}.
              </p>
              <p className="mt-1 text-ink/80">
                This tool only needs information about your organisation, never about the people you support
                or staff. Please remove it before sending.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="rounded-full bg-ink px-3 py-1.5 text-white"
                  onClick={() => {
                    setPiiWarning(null);
                    inputRef.current?.focus();
                  }}
                >
                  Edit my answer
                </button>
                {/* A phone number or email may be a work contact; an NHS number never is. */}
                {piiWarning.every((t) => t === 'phone number' || t === 'email address') && (
                  <button
                    type="button"
                    className="rounded-full border border-line px-3 py-1.5"
                    onClick={() => send(true)}
                  >
                    It is a work contact, send it
                  </button>
                )}
              </div>
            </div>
          )}

          <form
            className="mt-4 flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label htmlFor="answer" className="sr-only">
              {slot.kind === 'text' ? 'Your answer' : 'Or type your answer'}
            </label>
            <textarea
              id="answer"
              ref={inputRef}
              rows={1}
              value={draft}
              maxLength={LIMITS.maxMessage}
              onChange={(e) => {
                setDraft(e.target.value);
                setPiiWarning(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={
                slot.kind === 'text'
                  ? (slot.placeholder ?? 'Type your answer')
                  : 'Or type your answer, or ask a question'
              }
              className="field-sizing-content min-h-11 max-h-40 flex-1 resize-none rounded-xl border border-line bg-paper px-3 py-2.5 focus:border-brand focus:outline-none"
            />
            <button
              type="submit"
              disabled={!draft.trim() || pending}
              aria-label="Send"
              className="grid size-11 shrink-0 place-items-center rounded-full bg-brand text-white disabled:opacity-40 hover:bg-brand-dark"
            >
              {pending ? (
                <Loader2 className="size-5 animate-spin" aria-hidden="true" />
              ) : (
                <ArrowUp className="size-5" aria-hidden="true" />
              )}
            </button>
          </form>
        </div>

        <div ref={endRef} />
        {canUndo && (
          <button
            type="button"
            onClick={undo}
            disabled={pending}
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            Change my last answer
          </button>
        )}
      </section>

      <Progress prog={prog} />
    </div>
  );
}

function Chip({
  children,
  onClick,
  pressed,
  quiet,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  pressed?: boolean;
  quiet?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-left transition-colors disabled:opacity-50 ${
        pressed
          ? 'border-brand bg-brand-soft text-brand-dark font-semibold'
          : quiet
            ? 'border-dashed border-line text-muted hover:border-muted'
            : 'border-brand/40 bg-white text-brand-dark hover:border-brand hover:bg-brand-soft'
      }`}
    >
      {children}
    </button>
  );
}

function Progress({ prog }: { prog: ReturnType<typeof progress> }) {
  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
  return (
    <aside aria-label="Progress" className="order-first lg:order-none">
      <div className="lg:sticky lg:top-6 rounded-2xl border border-line bg-white p-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-semibold">Progress</span>
          <span className="text-muted">{pct}%</span>
        </div>
        <div
          className="mt-2 h-2 rounded-full bg-paper"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-2 rounded-full bg-leaf transition-all" style={{ width: `${pct}%` }} />
        </div>
        <ol className="mt-4 hidden lg:block space-y-2 text-sm">
          {prog.topics.map((t) => (
            <li
              key={t.id}
              className={`flex items-center gap-2 ${t.state === 'current' ? 'font-semibold text-ink' : t.state === 'done' ? 'text-ink/70' : 'text-muted'}`}
              aria-current={t.state === 'current' ? 'step' : undefined}
            >
              <span
                className={`grid size-5 place-items-center rounded-full text-[11px] ${
                  t.state === 'done'
                    ? 'bg-leaf text-white'
                    : t.state === 'current'
                      ? 'bg-brand text-white'
                      : 'bg-paper border border-line'
                }`}
              >
                {t.state === 'done' && <Check className="size-3.5" aria-hidden="true" />}
              </span>
              {t.title}
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}
