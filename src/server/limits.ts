// Abuse and cost control for a public tool with no accounts.
//
// Three layers:
//  - per-connection limits, so one script cannot run up the Mistral bill;
//  - a daily token budget across everyone, a hard ceiling on spend (the
//    Mistral console's own spending limit is the backstop behind it);
//  - a small queue, so a burst of requests waits instead of piling onto Mistral.
//
// A workshop room shares one IP address, so a valid workshop code (sent by the
// page in the X-Workshop-Code header) skips the per-connection limits. It does
// not skip the daily budget.
//
// The per-IP limiters key on the client IP, which on Fly arrives in
// X-Forwarded-For: `app.set('trust proxy', 1)` in index.ts is required.

import type { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';

const tooMany = {
  error: 'There have been a lot of requests from your connection. Please wait a few minutes and try again.',
};

export function hasWorkshopCode(req: Request): boolean {
  const code = req.get('x-workshop-code')?.trim();
  return !!code && config.workshopCodes.has(code);
}

const limiter = (limit: number) =>
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: tooMany,
    skip: hasWorkshopCode,
  });

export const turnLimiter = limiter(config.limits.turnsPerIpHour);
export const tailorLimiter = limiter(config.limits.tailorPerIpHour);

export class BudgetError extends Error {}
export class BusyError extends Error {}

let budgetDay = '';
let tokensToday = 0;

/**
 * Reserve an estimate of a call's tokens from today's budget. Resets at
 * midnight UTC and on restart. An estimate, charged up front, so a burst of
 * parallel calls cannot overshoot while they are in flight.
 */
export function chargeTokens(tokens: number): void {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== budgetDay) {
    budgetDay = today;
    tokensToday = 0;
  }
  if (tokensToday + tokens > config.limits.dailyTokenBudget) throw new BudgetError();
  tokensToday += tokens;
}

/** Rough token count for Mistral's tokenizer: about four characters a token in English. */
export const estimateTokens = (chars: number, maxOutput: number) => Math.ceil(chars / 4) + maxOutput;

let running = 0;
const waiting: (() => void)[] = [];

/** Wait for a slot to call the model. Returns the function that frees it. */
export async function acquireSlot(): Promise<() => void> {
  if (running >= config.limits.concurrency) {
    if (waiting.length >= config.limits.maxQueue) throw new BusyError();
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    running++;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = waiting.shift();
    if (next) next();
    else running--;
  };
}
