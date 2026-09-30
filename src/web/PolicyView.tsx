// The finished policy on screen: the full policy, the staff summary and the
// action plan, one after another, so printing gives all three.

import { useState } from 'react';
import { AlertTriangle, Download, ExternalLink, Pencil, Printer, RotateCcw } from 'lucide-react';
import { type Action, type Block, DISCLAIMER, type PolicyDoc } from '../shared/policy/types';
import { Rich } from './Rich';

const PRIORITY: Record<Action['priority'], { title: string; tone: string }> = {
  now: { title: 'Do now', tone: 'bg-red-50 text-red-800 border-red-200' },
  soon: { title: 'Do soon', tone: 'bg-amber-50 text-amber-900 border-amber-200' },
  later: { title: 'Do later', tone: 'bg-leaf-soft text-green-900 border-green-200' },
};

export function PolicyView({
  doc,
  tailored,
  onEdit,
  onRestart,
}: {
  doc: PolicyDoc;
  tailored: boolean;
  onEdit: () => void;
  onRestart: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      const { downloadDocx } = await import('./docx');
      await downloadDocx(doc);
    } catch {
      setError('The Word file could not be created. Try again, or use Print to save a PDF.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div>
      <div className="no-print">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Your AI use policy is ready</h1>
        <p className="mt-2 text-muted">
          Three parts: the policy, a one-page summary for staff, and an action plan of what still needs doing.
        </p>

        {doc.gaps > 0 && (
          <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">
            <AlertTriangle className="size-5 shrink-0 text-amber-600" aria-hidden="true" />
            <span>
              {doc.gaps === 1
                ? 'One thing is still to decide. It is'
                : `${doc.gaps} things are still to decide. They are`}{' '}
              marked <mark className="gap-marker">[TO DECIDE]</mark> in the policy. Fill{' '}
              {doc.gaps === 1 ? 'it' : 'them'} in before the policy is signed off.
            </span>
          </p>
        )}
        {!tailored && (
          <p className="mt-3 text-sm text-muted">
            The examples use our standard wording this time, because the tailoring service did not respond.
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={download}
            disabled={downloading}
            className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
          >
            <Download className="size-5" aria-hidden="true" />
            {downloading ? 'Preparing…' : 'Download Word document'}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2.5 hover:border-brand"
          >
            <Printer className="size-5" aria-hidden="true" />
            Print or save as PDF
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2.5 hover:border-brand"
          >
            <Pencil className="size-5" aria-hidden="true" />
            Change answers
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <nav aria-label="Parts" className="mt-6 flex flex-wrap gap-2 text-sm">
          {[
            ['#policy', 'Policy'],
            ['#summary', 'Staff summary'],
            ['#actions', `Action plan (${doc.actions.length})`],
          ].map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="rounded-full bg-brand-soft px-3 py-1 text-brand-dark hover:underline"
            >
              {label}
            </a>
          ))}
        </nav>
      </div>

      <article
        id="policy"
        className="policy-page mt-6 rounded-2xl border border-line bg-white p-5 sm:p-8 leading-relaxed"
      >
        <h2 className="text-3xl font-bold tracking-tight">AI use policy</h2>
        <p className="mt-1 text-xl font-semibold text-brand-dark">
          <Rich text={doc.orgName} />
        </p>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {doc.meta.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-semibold">{k}</dt>
              <dd>
                <Rich text={v} />
              </dd>
            </div>
          ))}
        </dl>
        {doc.sections.map((s, i) => (
          <section key={s.id} className="mt-8">
            <h3 className="text-xl font-bold">
              {i + 1}. {s.title}
            </h3>
            <Blocks blocks={s.blocks} />
          </section>
        ))}
      </article>

      <article
        id="summary"
        className="policy-page print-break mt-6 rounded-2xl border-2 border-brand bg-white p-5 sm:p-8 leading-relaxed"
      >
        <h2 className="text-2xl font-bold tracking-tight">
          <Rich text={doc.summary.title} />
        </h2>
        <p className="mt-1 text-sm text-muted no-print">Print this page and put it where people work.</p>
        <Blocks blocks={doc.summary.blocks} large />
      </article>

      <article
        id="actions"
        className="policy-page print-break mt-6 rounded-2xl border border-line bg-white p-5 sm:p-8 leading-relaxed"
      >
        <h2 className="text-2xl font-bold tracking-tight">Action plan: before this policy is true</h2>
        <p className="mt-1 text-muted">
          What your answers showed still needs doing. This list is for you, not part of the policy.
        </p>
        {(['now', 'soon', 'later'] as const).map((p) => {
          const own = doc.actions.filter((a) => a.priority === p);
          if (!own.length) return null;
          return (
            <section key={p} className="mt-6">
              <h3
                className={`inline-block rounded-full border px-3 py-0.5 text-sm font-semibold ${PRIORITY[p].tone}`}
              >
                {PRIORITY[p].title}
              </h3>
              <ul className="mt-3 space-y-4">
                {own.map((a) => (
                  <li key={a.id} className="border-l-4 border-line pl-4">
                    <p className="font-semibold">
                      <Rich text={a.title} />
                    </p>
                    <p className="mt-1 text-ink/85">
                      <Rich text={a.why} />
                    </p>
                    {a.link && (
                      <a
                        href={a.link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-sm text-brand hover:underline"
                      >
                        {a.link.label}
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </article>

      <p className="mt-6 text-sm italic text-muted">{DISCLAIMER}</p>

      <button
        type="button"
        onClick={onRestart}
        className="no-print mt-6 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"
      >
        <RotateCcw className="size-4" aria-hidden="true" />
        Start again and clear my answers
      </button>
    </div>
  );
}

function Blocks({ blocks, large }: { blocks: Block[]; large?: boolean }) {
  return (
    <div className={`mt-3 space-y-3 ${large ? 'text-lg' : ''}`}>
      {blocks.map((b, i) => {
        if (b.kind === 'p') {
          return (
            <p key={i}>
              <Rich text={b.text} />
            </p>
          );
        }
        if (b.kind === 'heading') {
          return (
            <h4 key={i} className="pt-2 font-bold">
              <Rich text={b.text} />
            </h4>
          );
        }
        if (b.kind === 'bullets') {
          return (
            <ul key={i} className={`list-disc pl-6 ${large ? 'space-y-3' : 'space-y-1.5'}`}>
              {b.items.map((item, j) => (
                <li key={j}>
                  <Rich text={item} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <div key={i} className="overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse text-sm">
              <thead>
                <tr>
                  {b.head.map((h) => (
                    <th
                      key={h}
                      className="border border-line bg-brand-soft px-3 py-2 text-left font-semibold"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j}>
                    {r.map((c, k) => (
                      <td key={k} className="border border-line px-3 py-2 align-top">
                        <Rich text={c} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
