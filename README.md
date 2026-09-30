# AI policy builder

A free tool from DailyFriend for UK care providers and care charities. A manager answers questions
about their organisation, mostly by tapping, sometimes by typing, and gets back three things:

1. **A full AI use policy** (15 sections, 6–10 pages). The governance record for CQC, the ICO and
   the board: named roles, an approved tools register, what AI may and may never be used for, data
   protection, checking, telling people, safeguarding, incidents, new tools, staff, records, review.
2. **A one-page staff summary.** The version people read. Printed and put on the wall.
3. **An action plan.** The gaps the answers showed ("staff use personal ChatGPT", "no DPIA"), in
   priority order, each linked to the guide on the AI in care hub that explains the fix.

Download as Word (built in the browser) or print to PDF. Built to be used live in a workshop, with
everyone on their own phone or laptop, and on the website.

## How it works

```
Browser (holds all answers, localStorage)            Server (Fly.io, London, stateless)
  tap an option ─────────────── no server call
  type an answer ── POST /api/turn ──────────────→  Mistral (EU API, Paris): read the answer
                 ←─ values + short reply ─────────   keep only values that fit the question
  review answers (form, no server call)
  build ────────── POST /api/tailor ─────────────→  Mistral, two calls side by side:
                                                       purpose paragraph + one example per task;
                                                       typed answers fitted into the policy's sentences
                 ←─ snippets that pass grounding ──   reject any sentence naming things not in the answers
  assemble policy + Word file in the browser
```

| Piece                                                     | Where                                                    |
| --------------------------------------------------------- | -------------------------------------------------------- |
| Every question, in order, and when it applies             | `src/shared/interview.ts`                                |
| What comes next, progress, validation of every value      | `src/shared/engine.ts`                                   |
| The policy wording (fixed clauses, chosen by the answers) | `src/shared/policy/assemble.ts`                          |
| The action plan rules                                     | `src/shared/policy/actions.ts`                           |
| Reading a typed answer                                    | `src/server/turn.ts`, `src/server/prompts/turn.ts`       |
| Tailored sentences and the grounding check                | `src/server/tailor.ts`, `src/server/grounding.ts`        |
| Personal identifier check before sending                  | `src/shared/pii.ts` (ported from the anonymiser)         |
| Word export                                               | `src/web/docx.ts`                                        |
| Tool facts, use pages and hub links                       | `src/shared/knowledge.generated.ts`, from `npm run sync` |

**The model never writes the rules.** The engine decides what to ask. The policy is fixed wording
based on the hub's checked guides and templates; answers only decide which clauses appear and fill in
names, roles and tools. The model does four small jobs: read typed answers, answer a question about
a term ("what is a DPIA?") from a fixed list of facts, write a purpose paragraph plus one example
sentence per task, and fit typed answers into the sentences they appear in ("As CEO I review it and
the board decides" becomes "the board" in "until ___ has approved it", and "CEO reviews; the board
decides" in the roles table; their own red lines become clauses of the "never" list). Any tailored
sentence that mentions a name, place, product or number not found in the answers is dropped, and the
default wording is used instead: a role answer that is more than a role is then named by its role
from section 3, and their own red lines are quoted as typed.

**Used or planned is not approved.** The builder asks which tools the organisation has already
agreed. Any other tool on a work account is listed as under review, is left off the staff summary,
and gets an action to decide on it.

**Unanswered means a visible gap, never a guess.** "Not sure" becomes `[TO DECIDE: …]` in the policy
and an item in the action plan.

**Decisions are only taken when asked.** A typed answer can fill in other open questions it states
directly ("I'm the registered manager and I look after data protection"). Questions the policy turns
on, such as the stance on AI, whether personal accounts are allowed, or whether a DPIA is done, are
marked `askDirectly` and are only recorded when they are the question being asked. List questions
mentioned in passing ("we're in Leeds") are pre-ticked, not answered.

**Plain answers skip the model.** "Yes", "no", "not sure" and an option's own wording are matched in
the browser (`matchOption`), so most of a session never reaches the server.

## Where the facts come from

`npm run sync` copies facts from `../../website-v2`: the tool directory (plans, data processing
agreements, hosting, training on data, each with its `checked` date), the use pages (which tasks
involve personal data), and the titles of guides and templates the action plan links to. Placeholder
and draft entries are skipped. Re-run it when the directory changes, and commit the result.

The policy wording draws on the hub's guides: writing an AI use policy, the golden rules, safeguarding
and AI, capacity and consent, telling people you support, what CQC says about AI, do you need a DPIA,
and the DHSC guidance summary. Clauses added from the September 2026 research brief were limited to
points that could be phrased safely: the Data (Use and Access) Act's restriction on solely automated
significant decisions (checked on legislation.gov.uk), US transfers under the UK Extension to the
Data Privacy Framework or an IDTA, fairness checks, staff voice, duty of candour (England only),
medical-device status for monitoring tools, and consent or best interests for monitoring. Draft CQC
assessment framework titles and dates are deliberately left out until CQC publishes them.

Regulator by nation: CQC (England), CIW (Wales), Care Inspectorate (Scotland), RQIA (Northern
Ireland). CQC regulations and principles are only cited for England.

**Before public launch, have a data protection specialist review the clause library.**
`npm run samples` writes a Word policy for each test organisation to `eval/out/` for that review.

## Privacy and security

- **Data location.** Server in London (Fly.io `lhr`). Typed answers go to Mistral's EU API (Paris);
  the address is hard-coded in `src/server/config.ts`. Tapped answers never leave the browser.
- **Mistral account.** Use a paid workspace (the free tier may use data for training), request Zero
  Data Retention, and set a monthly spending limit.
- **Nothing stored.** No database, no disk. Answers live in the visitor's browser (localStorage) and
  are cleared with "Start again". Logs record the event, question id, timing and token count, never
  a message, answer or reply.
- **Personal details.** The start screen and the interview ask for roles, not people. Before a typed
  answer is sent, the browser checks it for NHS numbers, National Insurance numbers, dates of birth,
  postcodes, phone numbers and email addresses. NHS number, NI number, date-of-birth and postcode hits must be removed;
  a phone number or email can be sent after confirming it is a work contact. The model is also told
  never to repeat personal details and to ask for roles instead.
- **Browser.** Strict Content Security Policy (own scripts and styles only), HSTS, no cookies, no
  analytics, no third-party scripts. Policy text is rendered as text, never HTML.

## Limits and workshops

A workshop room shares one IP address, so per-connection limits alone would block it.

| Setting                     | Default   | What it does                                                                                 |
| --------------------------- | --------- | -------------------------------------------------------------------------------------------- |
| `LIMIT_TURNS_PER_IP_HOUR`   | 600       | Typed answers per connection per hour                                                        |
| `LIMIT_TAILOR_PER_IP_HOUR`  | 60        | Policies built per connection per hour                                                       |
| `WORKSHOP_CODES`            | none      | Comma-separated codes (6+ characters). `?code=…` in the link skips the per-connection limits |
| `DAILY_TOKEN_BUDGET`        | 4,000,000 | Estimated Mistral tokens per UTC day across everyone. Applies with or without a code         |
| `CONCURRENCY` / `MAX_QUEUE` | 8 / 40    | Model calls at once, and how many wait                                                       |

Measured locally: 30 typed answers sent at the same moment all succeeded, median 3.3 s, slowest 5.5 s.
A full interview typed entirely in free text used about 30 turns and 40–60k tokens; tapping uses far
fewer.

**On the day of a workshop:**

1. `fly secrets set WORKSHOP_CODES=<new code>` (a new code each time).
2. Keep a machine warm so the first person does not wait for a cold start:
   `fly scale count 1`, then `fly machine update <id> --autostop=off`.
3. Share `https://<domain>/?code=<code>` as a QR code. The code is removed from the address bar
   once the page loads, and a "Workshop" badge confirms it was accepted.
4. Afterwards: remove the code and turn autostop back on.

## Run it

```bash
npm install
cp .env.example .env   # add MISTRAL_API_KEY
npm run dev            # http://localhost:5175, API on 8081
```

Tapping works without a key; typed answers and tailoring need one. If the tailoring call fails, the
policy is still built with the default wording.

## Checks

```bash
npm run typecheck && npm run lint && npm test
npm run samples        # Word policies for the five test organisations, no model calls
npm run eval           # model plays five managers and types every answer (needs a key)
```

`npm run eval` runs five fictional organisations (home care on personal ChatGPT, a charity on
Copilot, a care home with no AI but built-in AI and monitoring, supported living on Magic Notes, a
Welsh provider) and compares the recorded answers with the expected ones. The simulated manager is a
model too and sometimes strays from its brief, so read `eval/out/transcripts.txt` before changing a
prompt. September 2026 runs: 87–89% of answers matched, every persona finished in 27–34 turns, and
no tailored sentence failed the grounding check. The remaining mismatches reviewed were the simulator
answering off-brief.

## Deploy (Fly.io)

```bash
fly launch --copy-config --no-deploy --name dailyfriend-policy-builder --region lhr
fly secrets set MISTRAL_API_KEY=...
fly deploy --ha=false
fly certs add <domain>
```

Check `https://<app>.fly.dev/api/health` (process up) and `/api/ready` (Mistral key works). Mistral
keys expire: when `/api/ready` returns 503 with `credential_rejected`, replace the key.

## Limitations

- It writes a policy for the organisation as described. It cannot check that the answers are true,
  and the policy is only as accurate as they are.
- It is not legal advice. Complex uses (automated decisions, monitoring technology, large-scale
  processing) need a data protection specialist.
- Regulator detail outside England is deliberately general.
- Tool facts are as of each entry's `checked` date on the hub. Suppliers change their terms.

## Licence

AGPL-3.0-or-later. See `LICENSE`.
