// The whole session lives in this browser. Saved to localStorage so a refresh
// (or a flat laptop battery halfway through a workshop) does not lose the
// answers. Storage can be missing or blocked; everything works without it.

import type { Answers } from '../shared/interview';
import type { Snippets } from '../shared/policy/types';

export interface Message {
  role: 'assistant' | 'user';
  text: string;
  /** The question this message asks, for assistant question messages. */
  slot?: string;
}

export interface Session {
  v: 1;
  phase: 'start' | 'interview' | 'review' | 'policy';
  answers: Answers;
  messages: Message[];
  /** Slot ids set by each turn, newest last, so "change my last answer" can undo a whole turn. */
  turns: string[][];
  snippets?: Snippets;
  /** Options mentioned in passing for list questions still to come. */
  suggested?: Answers;
  startedAt: string;
}

const KEY = 'policy-builder:v1';

export function newSession(): Session {
  return { v: 1, phase: 'start', answers: {}, messages: [], turns: [], startedAt: new Date().toISOString() };
}

export function loadSession(): Session {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return newSession();
    const s = JSON.parse(raw) as Session;
    return s?.v === 1 && s.answers && Array.isArray(s.messages) ? s : newSession();
  } catch {
    return newSession();
  }
}

export function saveSession(s: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private window or storage full: the session still works until the tab closes */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

const CODE_KEY = 'policy-builder:workshop';

/** A workshop code from ?code=, kept for this tab so it survives reloads. */
export function workshopCode(): string {
  try {
    const fromUrl = new URLSearchParams(location.search).get('code')?.trim();
    if (fromUrl) {
      sessionStorage.setItem(CODE_KEY, fromUrl);
      // Keep the code out of the address bar, so a shared screenshot does not show it.
      history.replaceState(null, '', location.pathname);
      return fromUrl;
    }
    return sessionStorage.getItem(CODE_KEY) ?? '';
  } catch {
    return '';
  }
}
