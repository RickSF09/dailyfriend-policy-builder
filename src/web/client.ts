import type { TurnResponse } from '../shared/engine';
import type { Answers } from '../shared/interview';
import type { Snippets } from '../shared/policy/types';
import { workshopCode } from './store';

const code = workshopCode();

async function post<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(code ? { 'X-Workshop-Code': code } : {}) },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error('Could not reach the policy builder. Check your connection and try again.', { cause: e });
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error;
    throw new Error(message ?? 'Something went wrong. Please try again.');
  }
  return data as T;
}

export interface TurnInput {
  answers: Answers;
  slot: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  message: string;
}

export const sendTurn = (input: TurnInput, signal?: AbortSignal) =>
  post<TurnResponse>('/api/turn', input, signal);

export const tailor = (answers: Answers, signal?: AbortSignal) =>
  post<{ snippets: Snippets }>('/api/tailor', { answers }, signal);

/** Whether the server accepts this tab's workshop code. */
export async function checkWorkshop(): Promise<boolean> {
  if (!code) return false;
  try {
    const res = await fetch('/api/workshop', { headers: { 'X-Workshop-Code': code } });
    return ((await res.json()) as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
}
