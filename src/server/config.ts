// Runtime settings. Everything here is either non-secret or read from the
// environment (Fly secrets in production, a local .env in development).

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

export const config = {
  port: int('PORT', 8080),
  mistral: {
    // Hard-pinned, deliberately NOT read from the environment. Answers about
    // a care organisation go to Mistral's EU API (Paris) and nowhere else; a
    // stray env var must not be able to send them to another endpoint.
    baseUrl: 'https://api.mistral.ai',
    apiKey: process.env.MISTRAL_API_KEY ?? '',
    model: process.env.MISTRAL_MODEL ?? 'mistral-medium-latest',
    timeoutMs: 45_000,
  },
  limits: {
    /** Free-text answers one connection can send per hour. Chip answers never reach the server. */
    turnsPerIpHour: int('LIMIT_TURNS_PER_IP_HOUR', 600),
    /** Policies one connection can have tailored per hour. */
    tailorPerIpHour: int('LIMIT_TAILOR_PER_IP_HOUR', 60),
    /** Estimated Mistral tokens across everyone per UTC day: the cost ceiling. */
    dailyTokenBudget: int('DAILY_TOKEN_BUDGET', 4_000_000),
    /** Model calls at the same time; the rest wait in a queue. */
    concurrency: int('CONCURRENCY', 8),
    maxQueue: int('MAX_QUEUE', 40),
  },
  /**
   * Codes that lift the per-connection limits, for workshops where the whole
   * room shares one IP address. The daily budget still applies.
   */
  workshopCodes: new Set(
    (process.env.WORKSHOP_CODES ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c.length >= 6),
  ),
};

export function requireMistralKey(): string {
  if (!config.mistral.apiKey) {
    throw new Error('MISTRAL_API_KEY is not set');
  }
  return config.mistral.apiKey;
}
