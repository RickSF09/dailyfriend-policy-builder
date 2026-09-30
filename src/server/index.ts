// HTTP server: the two model endpoints, health checks, and the web page.
//
// Privacy rules for this file:
//  - nothing is stored: every request carries the answers it needs, and they
//    go out of scope when the response ends;
//  - no answer, message or reply is ever logged, only counts and timings.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { UserFacingError } from './errors.js';
import {
  acquireSlot,
  BudgetError,
  BusyError,
  hasWorkshopCode,
  tailorLimiter,
  turnLimiter,
} from './limits.js';
import { MistralError, tokenUsage } from './mistral.js';
import { readiness, startReadinessMonitor } from './readiness.js';
import { tailorRequestSchema, turnRequestSchema } from './schemas.js';
import { runTailor } from './tailor.js';
import { runTurn } from './turn.js';

const app = express();
app.disable('x-powered-by');
// Fly's proxy sets X-Forwarded-For; without this every visitor looks like one
// client to the rate limiter.
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
    referrerPolicy: { policy: 'no-referrer' },
  }),
);
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  next();
});

app.use('/api', express.json({ limit: '64kb' }));

function publicMessage(e: unknown): string {
  if (e instanceof UserFacingError) return e.message;
  if (e instanceof BudgetError)
    return 'The policy builder has reached its limit for today. Please try again tomorrow.';
  if (e instanceof BusyError) return 'The policy builder is busy right now. Please try again in a minute.';
  if (e instanceof MistralError && e.transient) {
    return 'The AI service is busy. Please try again in a minute.';
  }
  return 'Something went wrong. Please try again.';
}

function statusFor(e: unknown): number {
  if (e instanceof UserFacingError) return 400;
  if (e instanceof BudgetError || e instanceof BusyError) return 503;
  if (e instanceof MistralError && e.transient) return 503;
  return 500;
}

/**
 * Runs a model call in a queue slot and answers with JSON. Logs outcome,
 * timing and token counts, never content.
 */
async function handle(
  req: Request,
  res: Response,
  evt: string,
  job: () => Promise<{ body: object; stats?: object }>,
) {
  res.setHeader('Cache-Control', 'no-store');
  const started = Date.now();
  const tokensBefore = tokenUsage.prompt + tokenUsage.completion;
  let release: (() => void) | null = null;
  try {
    release = await acquireSlot();
    const { body, stats } = await job();
    res.json(body);
    console.log(
      JSON.stringify({
        evt,
        outcome: 'ok',
        ms: Date.now() - started,
        tokens: tokenUsage.prompt + tokenUsage.completion - tokensBefore,
        workshop: hasWorkshopCode(req) || undefined,
        ...stats,
      }),
    );
  } catch (e) {
    res.status(statusFor(e)).json({ error: publicMessage(e) });
    console.log(
      JSON.stringify({
        evt,
        outcome: 'error',
        error: e instanceof Error ? e.name : 'unknown',
        // Upstream status only; a MistralError body can echo the request.
        status: e instanceof MistralError ? e.status : undefined,
        ms: Date.now() - started,
      }),
    );
  } finally {
    release?.();
  }
}

const BAD_REQUEST = { error: 'That request was not in the expected format. Please reload the page.' };

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/ready', async (_req, res) => {
  const r = await readiness();
  res.status(r.ok ? 200 : 503).json(r);
});

/** Lets the page check a workshop code before showing that it is active. */
app.get('/api/workshop', (req, res) => {
  res.json({ ok: hasWorkshopCode(req) });
});

app.post('/api/turn', turnLimiter, (req, res) => {
  const parsed = turnRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(BAD_REQUEST);
    return;
  }
  void handle(req, res, 'turn', async () => {
    const out = await runTurn(parsed.data);
    return {
      body: out,
      stats: { slot: parsed.data.slot, recorded: Object.keys(out.values).length, stay: out.stay },
    };
  });
});

app.post('/api/tailor', tailorLimiter, (req, res) => {
  const parsed = tailorRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(BAD_REQUEST);
    return;
  }
  void handle(req, res, 'tailor', async () => {
    const { snippets, rejected } = await runTailor(parsed.data.answers);
    return { body: { snippets }, stats: { rejected } };
  });
});

// Malformed JSON and oversized bodies arrive here before any handler runs.
app.use('/api', (err: unknown, _req: Request, res: Response, next: NextFunction) => {
  const status = (err as { status?: number })?.status;
  if (status === 400 || status === 413) {
    res.status(status).json(BAD_REQUEST);
    return;
  }
  next(err);
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// The built web page. In development Vite serves it and proxies /api here.
const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
app.use(
  express.static(webDir, {
    index: 'index.html',
    maxAge: '1y',
    immutable: true,
    // Asset names carry a content hash; the page itself must never be stale.
    setHeaders: (res, file) => {
      if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }),
);
app.get(/.*/, (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(webDir, 'index.html'));
});

app.listen(config.port, () => {
  console.log(
    JSON.stringify({
      evt: 'listening',
      port: config.port,
      model: config.mistral.model,
      workshopCodes: config.workshopCodes.size,
    }),
  );
  startReadinessMonitor();
});
