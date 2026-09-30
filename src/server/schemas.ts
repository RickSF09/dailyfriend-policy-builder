// What the browser may send. Sizes are capped so a request stays small.
// Server-only, so the page does not carry a validation library.

import { z } from 'zod';
import { LIMITS } from '../shared/engine.js';

const answerValue = z.union([z.string().max(400), z.array(z.string().max(80)).max(40)]);

export const answersSchema = z
  .record(z.string().max(60), answerValue)
  .refine((r) => Object.keys(r).length <= 80);

export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(LIMITS.maxMessage + 1000),
});

export const turnRequestSchema = z.object({
  answers: answersSchema,
  slot: z.string().max(60),
  history: z.array(chatMessageSchema).max(LIMITS.historyTurns * 2),
  message: z.string().min(1).max(LIMITS.maxMessage),
});

export const tailorRequestSchema = z.object({ answers: answersSchema });
