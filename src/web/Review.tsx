// Every answer on one page, editable. Changes here need no model call; the
// policy is rebuilt from the answers when they press build.

import { ArrowLeft, FileText, Loader2 } from 'lucide-react';
import { applyValues, coerce, nextSlot, prune } from '../shared/engine';
import { type AnswerValue, type Answers, type Slot, TOPICS, UNSURE, visibleSlots } from '../shared/interview';

export function Review({
  answers,
  onChange,
  onBuild,
  onBack,
  building,
  error,
}: {
  answers: Answers;
  onChange: (a: Answers) => void;
  onBuild: () => void;
  onBack: () => void;
  building: boolean;
  error: string | null;
}) {
  const slots = visibleSlots(answers);
  const missing = slots.filter((s) => answers[s.id] === undefined).length;

  function set(slot: Slot, value: AnswerValue | undefined) {
    if (value === undefined) {
      const next = { ...answers };
      delete next[slot.id];
      onChange(prune(next));
      return;
    }
    const v = coerce(slot, value);
    if (v !== undefined) onChange(prune(applyValues(answers, { [slot.id]: v })));
  }

  return (
    <div>
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Check your answers</h1>
      <p className="mt-2 text-muted">
        Change anything that is not quite right. Anything marked “Not sure” becomes a clearly marked gap in
        the policy for you to fill in later.
      </p>

      <div className="mt-6 space-y-6">
        {TOPICS.map((topic) => {
          const own = slots.filter((s) => s.topic === topic.id);
          if (!own.length) return null;
          return (
            <section key={topic.id} className="rounded-2xl border border-line bg-white p-4 sm:p-5">
              <h2 className="text-lg font-bold">{topic.title}</h2>
              <div className="mt-3 divide-y divide-line">
                {own.map((slot) => (
                  <Field key={slot.id} slot={slot} value={answers[slot.id]} onSet={(v) => set(slot, v)} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBuild}
          disabled={building}
          className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-3 font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {building ? (
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            <FileText className="size-5" aria-hidden="true" />
          )}
          {building ? 'Writing your policy…' : 'Build my policy'}
        </button>
        {nextSlot(answers) && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-brand hover:underline"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to the questions ({missing} left)
          </button>
        )}
      </div>
    </div>
  );
}

function Field({
  slot,
  value,
  onSet,
}: {
  slot: Slot;
  value: AnswerValue | undefined;
  onSet: (v: AnswerValue | undefined) => void;
}) {
  const id = `f-${slot.id}`;
  const unsureLabel = slot.optional ? 'Skipped' : 'Not sure';
  return (
    <div className="py-3 grid gap-2 sm:grid-cols-[14rem_1fr] sm:items-start">
      <label htmlFor={id} className="font-medium text-sm pt-2">
        {slot.label}
      </label>
      <div>
        {slot.kind === 'choice' && (
          <select
            id={id}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onSet(e.target.value || undefined)}
            className="w-full rounded-lg border border-line bg-paper px-3 py-2"
          >
            <option value="">Not answered</option>
            {slot.options?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
            <option value={UNSURE}>{unsureLabel}</option>
          </select>
        )}

        {slot.kind === 'text' && (
          <input
            id={id}
            type="text"
            defaultValue={typeof value === 'string' && value !== UNSURE ? value : ''}
            placeholder={value === UNSURE ? unsureLabel : 'Not answered'}
            maxLength={slot.maxLength ?? 300}
            onBlur={(e) => {
              const t = e.target.value.trim();
              if (t) onSet(t);
              else if (value !== UNSURE) onSet(undefined);
            }}
            className="w-full rounded-lg border border-line bg-paper px-3 py-2"
          />
        )}

        {slot.kind === 'multi' && (
          <fieldset id={id} className="flex flex-wrap gap-x-4 gap-y-2">
            <legend className="sr-only">{slot.label}</legend>
            {slot.options?.map((o) => {
              const current = Array.isArray(value) ? value : [];
              const on = current.includes(o.id);
              return (
                <label key={o.id} className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      const next = on ? current.filter((x) => x !== o.id) : [...current, o.id];
                      onSet(next.length ? next : undefined);
                    }}
                    className="size-4 accent-brand"
                  />
                  {o.label}
                </label>
              );
            })}
            {value === UNSURE && <span className="text-sm text-muted">({unsureLabel})</span>}
          </fieldset>
        )}
      </div>
    </div>
  );
}
