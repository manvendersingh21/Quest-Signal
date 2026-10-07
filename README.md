# QuestSignal

QuestSignal is the commercial desk on [TradesQuest](https://stonebyte.bid/). A learner’s quest evidence runs through four specialist agents — Assessor, Coach, Matcher, and GEO Publisher — and comes out as three things a judge can open:

1. A skills profile.
2. An employer shortlist with a proposed candidate order.
3. A public page with quotations, citations, JSON-LD, and an `llms.txt` summary.

The game is the engagement. Contractors, unions, and workforce boards need a record they can check. QuestSignal drafts that record from quest evidence. **A person confirms the draft before it is called hire-ready.** The record supplements time on a job.

XP stays on the game card. The profile instead shows fit, confidence on the work, a mentor, and task variety.

## How to run

```bash
cd /agent/questsignal
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173).

No install step and no API keys. Node 20 or newer. `npm test` runs the claim and ranking checks.

## What is live, and what is a fixture

**Live.** This server calls `GET https://stonebyte.bid/api/health` and shows the JSON on the desk. The host does not send CORS headers, so the browser does not call it. The demo does not call signup, sign-in, early-access, or CRM.

**Fixture.** Quest evidence, XP, and employers are sample data in `src/data/fixture.js`. They are labeled on every page. The TradesQuest host’s live JSON API is auth and admin CRM only (`POST /api/early-access`, `POST /api/signup`, `POST /api/signin`, `GET /api/health`, and `/api/crm/*`). There is no players, XP, quests, or apprenticeship endpoint. Do not treat the sample apprentices as live game records.

## 60-second judge script

1. Open http://127.0.0.1:4173. Read the fixture banner and the live health line.
2. Choose **Maya Chen**.
3. Watch Assessor, Coach, Matcher, and GEO Publisher. Each card shows its input and output. XP is on the card and out of the signal. Fit, confidence, the mentor, and task variety are separate.
4. Click **Confirm this draft as reviewer**. That is the human step. Until then, the record is not called hire-ready.
5. On the skills profile, the words hire-ready appear because you confirmed a draft that cleared the evidence bar. The line under the name says the record supplements time on a job.
6. Open **Proposed shortlist** (Bayline Electric). Maya is proposed ahead of Devon Brooks, who has more game XP and a failed lockout scenario. The order is a recommendation a recruiter confirms. The lockout score is one scenario, measured right after it.
7. Open **Public page**. The evidence table is high on the page: a quotation, a quest ID, and when it was measured. JSON-LD and `llms.txt` are on the page. The page does not promise that an answer engine will cite it.

## What this demo does not claim

It does not claim injury reduction, a license, degree-free hiring in the trades, or a citation-lift number. It does not say employers already hire on badges, or that a points total is why an apprentice stays. Agents propose. A person confirms.

## Routes

| Path | What it is |
| --- | --- |
| `/` | Pick a sample apprentice |
| `/desk/maya-chen` | The four agents, then the confirm button |
| `/profiles/maya-chen` | Skills profile |
| `/employers` | Shortlist across sample desks |
| `/employers/bayline-electric` | Proposed order for one desk |
| `/p/maya-chen` | Public page |
| `/p/maya-chen/llms.txt` | Short summary for an answer engine |
| `/api/status` | Live health plus the fixture note |
| `/api/desk/maya-chen` | Agent inputs and outputs as JSON |
