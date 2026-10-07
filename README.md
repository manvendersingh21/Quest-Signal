# QuestSignal

QuestSignal is the commercial desk on [TradesQuest](https://stonebyte.bid/). A learner’s quest evidence runs through four specialist agents — Assessor, Coach, Matcher, and GEO Publisher — and comes out as three things a judge can open:

1. A skills profile.
2. An employer shortlist with a proposed candidate order.
3. A public page with quotations, citations, JSON-LD, and an `llms.txt` summary.

The game is the engagement. Contractors, unions, and workforce boards need a record they can check. QuestSignal drafts that record from quest evidence. **A person confirms the draft before it is called hire-ready.** The record supplements time on a job.

XP stays on the game card. The profile instead shows fit, confidence on the work, a mentor, and task variety.

## How to run

Live: **https://questsignal.vercel.app**

Locally:

```bash
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173).

Node 20 or newer. Local runs need no install step: visitor records live in process memory, and `@vercel/blob` (the one dependency) is loaded only when `BLOB_READ_WRITE_TOKEN` is set. `npm test` runs the claim, ranking, intake, and HTTP checks.

## Deploy

The app deploys to Vercel as-is (`vercel deploy --prod`). Vercel runs `server.js` as the entrypoint; the request handler lives in `src/http/app.js`.

| Env var | What it does |
| --- | --- |
| `SESSION_SECRET` | Signs the review cookie. A reviewer's decision lives in that visitor's own cookie, so every judge runs the human step on a clean record and any serverless instance can read it. The server re-checks the evidence bar, so an edited cookie cannot promote a draft. |
| `OPENAI_API_KEY` | Lets the Coach agent write its headline and interview script with a model. Pages render immediately from cache or rules; the browser fetches `/api/coach/:id` and swaps in the model text only if every quotation matches quest evidence verbatim, every quest ID is on file, the rule-decided status is restated, and no claim limit is crossed. One repair attempt, then rules. |
| `OPENAI_MODEL` | Defaults to `gpt-5-mini` (called with minimal reasoning, ~2–3 s). |
| `BLOB_READ_WRITE_TOKEN` | Added by `vercel blob create-store questsignal-records --access private`. Visitor records from `/new` are saved as private blobs (`records/<id>.json`), one per record, written once with `allowOverwrite: false`. There is no index blob and no list route. Without it, records live in process memory (tests, local runs) and vanish on restart. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Optional. Upstash Redis (Vercel marketplace) shares the model-written Coach scripts across instances. Without them, each instance keeps its own cache. `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` also work. |

`/api/status` reports `reviewState`, `visitorRecords` (`blob` or `memory`), `modelCache` (`redis` or `memory`), and `coachWriter`. Locally, `npm start` reads `.env` if present.

Scores, gaps, the safety gate, employer ranking, and the human confirm step never use the model.

## What is live, and what is a fixture

**Live.** This server calls `GET https://stonebyte.bid/api/health` and shows the JSON on the desk. The host does not send CORS headers, so the browser does not call it. The demo does not call signup, sign-in, early-access, or CRM.

**Model.** When `OPENAI_API_KEY` is set, the server sends the selected quest evidence (sample data) to OpenAI to write the Coach headline and interview script. That text is shown only after it passes the quotation, citation, status, and claim checks. Nothing else on the desk comes from a model.

**Fixture.** Quest evidence, XP, and employers are sample data in `src/data/fixture.js`. They are labeled on every page. The TradesQuest host’s live JSON API is auth and admin CRM only (`POST /api/early-access`, `POST /api/signup`, `POST /api/signin`, `GET /api/health`, and `/api/crm/*`). There is no players, XP, quests, or apprenticeship endpoint. Do not treat the sample apprentices as live game records.

## Real use

A mentor or training program can enter a real apprentice at **`/new`** (also linked as **Add apprentice** in the header). The form takes name, trade, specialty, city, region, fit in their words, a confidence quote, an optional mentor, task variety, and 3–8 quest evidence rows (competency from that trade's rubric, quest title, score 0–100, and what was observed). A checkbox confirms the apprentice gave permission to publish.

The server checks every field (lengths, score range, competency belongs to the trade), assigns quest IDs `V-001…`, and saves a record shaped like a fixture apprentice (`xp: 0`, `source: "visitor"`) under a random id such as `r-k3x9q2m7a0bd`. It then redirects to `/desk/<id>`, where the same four agents run: the desk, the skills profile, matches against the sample employers (`/employers/<id>?highlight=<record>` adds the record to that one view only), and the public page with JSON-LD and `llms.txt`. The human confirm step works the same way, in the visitor's cookie.

What stays honest:

- Every page, the JSON-LD (`creditText`), and `llms.txt` say **“Entered by a visitor. Not verified by TradesQuest.”** These records are never labeled as the demo fixture.
- Typed text may not carry the claims this desk refuses to make (hire-ready, licenses, certification, injuries, wages, guarantees). The form says so and rejects them.
- Record pages send `noindex` (meta tag and `X-Robots-Tag`, including `llms.txt`) and stay out of `sitemap.xml` and the root `/llms.txt`. Anyone with the link can open a record; nobody can list them.
- Visitor records are not sent to a model. Their Coach script is always rule-based.
- Records are write-once. There is no edit or delete button on the site; the operator removes a record from the Blob store.
- The evidence bar is the same as for the fixture (safety 80+, four evidenced competencies, weighted signal 75+). A short record stays in training even after a reviewer confirms it.

## 60-second judge script

1. Open http://127.0.0.1:4173. Read the fixture banner and the live health line.
2. Choose **Maya Chen**.
3. Watch Assessor, Coach, Matcher, and GEO Publisher. Each card shows its input and output. XP is on the card and out of the signal. Fit, confidence, the mentor, and task variety are separate.
4. Click **Confirm this draft as reviewer** (your name is optional; the review is kept in your browser, so the next judge gets a clean draft). That is the human step. Until then, the record is not called hire-ready.
5. On the skills profile, the words hire-ready appear because you confirmed a draft that cleared the evidence bar. The line under the name says the record supplements time on a job.
6. Open **Proposed shortlist** (Bayline Electric). Maya is proposed ahead of Devon Brooks, who has more game XP and a failed lockout scenario. The order is a recommendation a recruiter confirms. The lockout score is one scenario, measured right after it.
7. Open **Public page**. The evidence table is high on the page: a quotation, a quest ID, and when it was measured. JSON-LD and `llms.txt` are on the page. The page does not promise that an answer engine will cite it.

## What this demo does not claim

It does not claim injury reduction, a license, degree-free hiring in the trades, or a citation-lift number. It does not say employers already hire on badges, or that a points total is why an apprentice stays. Agents propose. A person confirms.

## Routes

| Path | What it is |
| --- | --- |
| `/` | Pick a sample apprentice, or add one |
| `/new`, `POST /new` | Intake form for a real apprentice; saves a visitor record and redirects to its desk |
| `/desk/maya-chen`, `/desk/r-…` | The four agents, then the confirm button (fixture id or visitor record id) |
| `POST /desk/maya-chen/confirm` | Reviewer confirms the draft (stored in this visitor's signed cookie) |
| `POST /desk/maya-chen/reset` | Reviewer returns the record to draft |
| `/profiles/maya-chen` | Skills profile |
| `/employers` | Shortlist across sample desks |
| `/employers/bayline-electric` | Proposed order for one desk |
| `/p/maya-chen` | Public page |
| `/p/maya-chen/llms.txt` | Short summary for an answer engine |
| `/api/status` | Live health plus the fixture note |
| `/api/desk/maya-chen` | Agent inputs and outputs as JSON |
| `/api/coach/maya-chen` | Coach script (model-written when it passes the checks) |
| `/sitemap.xml`, `/robots.txt` | Crawl hints for the fixture public pages (visitor records are left out) |

Every `:id` route above (`/desk`, `/profiles`, `/p`, `/p/:id/llms.txt`, `/api/desk`, `/api/coach`, confirm and reset) accepts a visitor record id as well as a fixture id. Form posts larger than 32 KB get a 413.
