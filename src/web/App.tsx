import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BrainCircuit,
  ClipboardList,
  FileText,
  ListChecks,
  MapPin,
  MessagesSquare,
  NotebookPen,
  ShieldCheck,
  Trash2,
  Users,
  UserX,
} from 'lucide-react';
import { assemblePolicy } from '../shared/policy/assemble';
import { Chat } from './Chat';
import { checkWorkshop, tailor } from './client';
import { PolicyView } from './PolicyView';
import { begin } from './session';
import { Review } from './Review';
import { clearSession, loadSession, newSession, type Session, saveSession } from './store';
import logoUrl from './assets/logo.svg';

const SOURCE_URL = 'https://github.com/RickSF09/dailyfriend-policy-builder';

export function App() {
  const [session, setSession] = useState<Session>(loadSession);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [tailored, setTailored] = useState(true);
  const [workshop, setWorkshop] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => saveSession(session), [session]);
  useEffect(() => {
    void checkWorkshop().then(setWorkshop);
    return () => abortRef.current?.abort();
  }, []);
  // Each screen starts at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [session.phase]);

  const doc = useMemo(
    () => (session.phase === 'policy' ? assemblePolicy(session.answers, session.snippets ?? {}) : null),
    [session.phase, session.answers, session.snippets],
  );

  function restart() {
    if (!window.confirm('Clear all your answers and start again?')) return;
    abortRef.current?.abort();
    clearSession();
    setSession(newSession());
  }

  async function build() {
    setBuilding(true);
    setBuildError(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const { snippets } = await tailor(session.answers, ctrl.signal);
      setTailored(true);
      setSession((s) => ({ ...s, snippets, phase: 'policy' }));
    } catch {
      if (ctrl.signal.aborted) return;
      // The fixed wording is a complete policy on its own; tailoring is a nicety.
      setTailored(false);
      setSession((s) => ({ ...s, snippets: {}, phase: 'policy' }));
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="no-print border-b border-line bg-white">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center gap-3">
          <img src={logoUrl} alt="DailyFriend" className="h-7 w-auto" />
          <span className="text-sm font-semibold text-muted border-l border-line pl-3">
            AI policy builder
          </span>
          {workshop && (
            <span className="ml-auto rounded-full bg-leaf-soft px-2.5 py-0.5 text-xs font-semibold text-green-800">
              Workshop
            </span>
          )}
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-8 sm:py-10">
        {session.phase === 'start' && (
          <Start
            resumable={Object.keys(session.answers).length > 0}
            onStart={() => setSession((s) => begin(s))}
            onRestart={restart}
          />
        )}
        {session.phase === 'interview' && (
          <div className="mx-auto max-w-4xl">
            <Chat session={session} update={setSession} />
            <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <button
                type="button"
                className="text-muted hover:text-ink underline"
                onClick={() => setSession((s) => ({ ...s, phase: 'review' }))}
              >
                See all my answers
              </button>
              <button type="button" className="text-muted hover:text-ink underline" onClick={restart}>
                Start again
              </button>
            </div>
          </div>
        )}
        {session.phase === 'review' && (
          <div className="mx-auto max-w-3xl">
            <Review
              answers={session.answers}
              onChange={(answers) => setSession((s) => ({ ...s, answers }))}
              onBuild={build}
              onBack={() => setSession((s) => begin(s))}
              building={building}
              error={buildError}
            />
          </div>
        )}
        {session.phase === 'policy' && doc && (
          <div className="mx-auto max-w-3xl">
            <PolicyView
              doc={doc}
              tailored={tailored}
              onEdit={() => setSession((s) => ({ ...s, phase: 'review' }))}
              onRestart={restart}
            />
          </div>
        )}
      </main>

      <footer className="no-print border-t border-line bg-white">
        <div className="mx-auto max-w-5xl px-4 py-5 text-xs text-muted flex flex-wrap gap-x-4 gap-y-1">
          <span>A free tool from DailyFriend</span>
          <span>Your answers stay in your browser</span>
          <span>Not legal advice</span>
          <a className="underline hover:text-ink" href={SOURCE_URL} target="_blank" rel="noreferrer">
            Source code (AGPL-3.0)
          </a>
        </div>
      </footer>
    </div>
  );
}

const PARTS = [
  {
    icon: FileText,
    title: 'A full AI policy',
    text: 'Named roles, approved tools, and what AI may and may not do. Ready to sign off.',
  },
  {
    icon: ClipboardList,
    title: 'A one-page staff summary',
    text: 'The version people actually read. Print it and put it up.',
  },
  {
    icon: ListChecks,
    title: 'An action plan',
    text: 'The gaps your answers showed, in order, with guides to close them.',
  },
];

const SAFETY = [
  { icon: Trash2, title: 'Nothing stored', text: 'Answers stay in your browser' },
  { icon: MapPin, title: 'UK & EU only', text: 'London server, AI in Paris' },
  { icon: BrainCircuit, title: 'Never trains AI', text: 'Paid Mistral service' },
  { icon: NotebookPen, title: 'You write it', text: 'Your answers, reviewed wording' },
  { icon: ShieldCheck, title: 'No guessing', text: 'Gaps are marked, not invented' },
  { icon: UserX, title: 'No account', text: 'No cookies, no tracking' },
];

function Start({
  resumable,
  onStart,
  onRestart,
}: {
  resumable: boolean;
  onStart: () => void;
  onRestart: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Write your AI use policy</h1>
      <p className="mt-3 text-lg text-muted">
        Answer questions about your care organisation. Get a policy that names your tools, your people and
        your rules, in about fifteen minutes.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onStart}
          className="inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3 text-lg font-semibold text-white hover:bg-brand-dark"
        >
          {resumable ? 'Carry on where I left off' : 'Start'}
          <ArrowRight className="size-5" aria-hidden="true" />
        </button>
        {resumable && (
          <button type="button" onClick={onRestart} className="text-muted underline hover:text-ink">
            Start again
          </button>
        )}
      </div>

      <p className="mt-6 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
        <Users className="size-5 shrink-0 text-amber-700 mt-0.5" aria-hidden="true" />
        <span>
          <strong>Answer about your organisation, not about people.</strong> Roles like “Registered Manager”
          are all it needs. Never type the names or details of people you support or of staff.
        </span>
      </p>

      <section className="mt-10" aria-labelledby="you-get">
        <h2 id="you-get" className="text-xl font-bold tracking-tight">
          What you get
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          {PARTS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="rounded-xl bg-white border border-line p-4">
              <span className="grid size-10 place-items-center rounded-full bg-brand-soft text-brand">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <p className="mt-3 font-semibold">{title}</p>
              <p className="mt-1 text-sm text-muted">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10" aria-labelledby="how">
        <h2 id="how" className="text-xl font-bold tracking-tight">
          How it works
        </h2>
        <ol className="mt-4 space-y-3">
          {[
            [
              MessagesSquare,
              'Answer the questions',
              'Tap an answer, or type in your own words. Ask what anything means as you go.',
            ],
            [
              ListChecks,
              'Check your answers',
              'Everything on one page. “Not sure” is fine: it becomes a marked gap to fill in later.',
            ],
            [
              FileText,
              'Download your policy',
              'As a Word document you can edit, or print it. Then take it for sign-off.',
            ],
          ].map(([Icon, title, text], i) => {
            const I = Icon as typeof MessagesSquare;
            return (
              <li key={i} className="flex gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
                  <I className="size-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="font-semibold">{title as string}.</span>{' '}
                  <span className="text-muted">{text as string}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="mt-10" aria-labelledby="why-safe">
        <h2 id="why-safe" className="text-xl font-bold tracking-tight">
          Why it is safe to use
        </h2>
        <ul className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {SAFETY.map(({ icon: Icon, title, text }) => (
            <li key={title} className="rounded-xl bg-white border border-line p-4">
              <span className="grid size-10 place-items-center rounded-full bg-leaf-soft text-green-700">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <p className="mt-3 font-semibold">{title}</p>
              <p className="text-sm text-muted">{text}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted leading-relaxed">
          The policy is built from fixed wording based on published guidance from CQC, the ICO and the
          Department of Health and Social Care. AI reads what you type and tailors a few example sentences; it
          does not write your rules. What you type is sent to our London server only while a reply is being
          written, and on to Mistral’s EU service in Paris, on a paid plan that does not train on it. Nothing
          is stored on our side.
        </p>
      </section>
    </div>
  );
}
