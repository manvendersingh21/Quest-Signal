import { PROBE } from "../tradesquest/client.js";

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function jsonBlock(value) {
  return esc(JSON.stringify(value, null, 2));
}

function jsonLd(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function reviewLabel(confirmation, clearsDraftBar) {
  if (confirmation?.decision === "confirm-record" && clearsDraftBar) {
    return { tone: "ok", text: "Hire-ready · reviewer confirmed" };
  }
  if (confirmation) return { tone: "hold", text: "Reviewed · kept in training" };
  return { tone: "draft", text: "Draft · awaiting a person" };
}

function healthLine(health) {
  if (health?.live && health.body) {
    return `Live ${PROBE.liveRead.method} ${health.url} → ${health.body.status} · ${health.body.environment} · ${health.body.timestamp}`;
  }
  return `Live GET https://stonebyte.bid/api/health did not return JSON${health?.error ? ` (${health.error})` : ""}. The desk still runs on the fixture.`;
}

function sourceBanner(health) {
  return `<section class="banner">
    <strong>Quest evidence, XP, and employers are a demo fixture.</strong>
    <p>The TradesQuest host publishes auth and CRM routes. It has no players, quests, XP, or apprenticeship API. This server calls health only, because the host sends no CORS headers and this demo does not create signups.</p>
    <p class="mono">${esc(healthLine(health))}</p>
  </section>`;
}

function sourceStrip(health) {
  return `<p class="banner"><strong>Demo fixture, not a live player record.</strong> <span class="mono">${esc(healthLine(health))}</span></p>`;
}

function chip(label) {
  return `<span class="chip ${label.tone === "ok" ? "ok" : label.tone === "hold" ? "hold" : ""}">${esc(label.text)}</span>`;
}

function layout({ title, description, health, main, extraHead = "", play = false }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap">
  <link rel="stylesheet" href="/styles.css">
  ${play ? "<script>document.documentElement.classList.add('js')</script>" : ""}
  ${extraHead}
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <header class="top">
    <nav aria-label="Main">
      <a href="/">Apprentices</a>
      <a href="/employers">Employers</a>
      <a href="/desk/maya-chen">Judge path</a>
    </nav>
    <a class="brand" href="/">Quest<span>Signal</span></a>
    <div class="nav-right">
      <span class="pill ${health?.live ? "" : "warn"}">${health?.live ? "TradesQuest live" : "Health unread"}</span>
    </div>
  </header>
  <main id="main" class="wrap">
    ${main}
  </main>
  <footer class="site">QuestSignal demo for the Musa Labs hackathon. Sample people and employers. A person confirms a draft before it is called hire-ready. The public page quotes evidence and cites quest IDs. It does not promise a citation.</footer>
</body>
</html>`;
}

function writerNote(writer) {
  if (writer?.source === "model") {
    return `Written by ${writer.model} from the quest evidence. Every quotation and quest ID was checked against the record.`;
  }
  if (writer?.source === "pending") return `${writer.model} is writing the script from the quest evidence…`;
  if (writer?.model) return `Rule-based script. ${writer.note}`;
  return "Rule-based script. No model key on this server.";
}

/** Coach headline and interview script. Fills in from /api/coach/:id when the model is still writing. */
export function coachScript(apprenticeId, coaching) {
  const writer = coaching.writer || { source: "rules" };
  const points = coaching.interviewPoints.map((point) => `<li>${esc(point)}</li>`).join("");
  return `<section class="script" data-coach="${esc(apprenticeId)}" data-state="${esc(writer.source)}" aria-live="polite">
      <p class="script-head">${esc(coaching.headline)}</p>
      <h3>Interview script</h3>
      <ul class="script-points">${points}</ul>
      <p class="meta script-note">${esc(writerNote(writer))}</p>
    </section>`;
}

const COACH_SCRIPT = `<script>
  (() => {
    const box = document.querySelector('[data-coach][data-state="pending"]');
    if (!box) return;
    const put = (sel, text) => { const el = box.querySelector(sel); if (el) el.textContent = text; };
    fetch("/api/coach/" + box.dataset.coach, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then((data) => {
        const w = data.writer || {};
        box.dataset.state = w.source || "rules";
        if (w.source === "model") {
          put(".script-head", data.headline);
          const list = box.querySelector(".script-points");
          list.replaceChildren(...data.interviewPoints.map((p) => { const li = document.createElement("li"); li.textContent = p; return li; }));
          put(".script-note", "Written by " + w.model + " from the quest evidence. Every quotation and quest ID was checked against the record.");
        } else {
          put(".script-note", "Rule-based script. " + (w.note || ""));
        }
        const log = document.querySelector('.agent[data-agent="Coach"] .log');
        const last = data.log && data.log[data.log.length - 1];
        if (log && last) {
          const li = document.createElement("li");
          const tag = document.createElement("span");
          tag.className = "phase";
          tag.textContent = last.phase;
          li.append(tag, " " + last.text);
          log.append(li);
        }
      })
      .catch(() => { box.dataset.state = "rules"; put(".script-note", "Rule-based script. The model did not answer in time."); });
  })();
</script>`;

function agentCard(step, index, extra = "") {
  const lines = step.log
    .map((line) => `<li><span class="phase">${esc(line.phase)}</span> ${esc(line.text)}</li>`)
    .join("");
  return `<article class="agent" data-agent="${esc(step.name)}">
    <header>
      <div>
        <p class="who">0${index + 1} · ${esc(step.name)}</p>
        <h2>${esc(step.name)}</h2>
      </div>
    </header>
    <p>${esc(step.mandate)}</p>
    <ol class="log">${lines}</ol>
    ${extra}
    <details open>
      <summary>Input and output</summary>
      <pre class="code" tabindex="0">${jsonBlock({ input: step.input, output: step.output })}</pre>
    </details>
  </article>`;
}

export function renderHome({ health, cards, confirmations = {} }) {
  const people = cards
    .map((card, index) => {
      const label = reviewLabel(confirmations[card.apprentice.id], card.assessment.clearsDraftBar);
      const featured = card.apprentice.id === "maya-chen";
      return `<article class="card ${featured ? "featured" : ""}">
        <span class="num">${String(index + 1).padStart(2, "0")}.</span>
        <h3>${esc(card.apprentice.name)}</h3>
        <div class="chips">${chip(label)}<span class="chip plain">Sample</span></div>
        <p class="meta">${esc(card.apprentice.specialty)} · ${esc(card.apprentice.city)}</p>
        <p class="meta">Draft signal ${card.assessment.signalScore}/100 · game XP ${card.apprentice.xp.toLocaleString("en-US")}</p>
        <div class="actions">
          <a class="btn ${featured ? "primary" : ""}" href="/desk/${esc(card.apprentice.id)}">${featured ? "Start the judge path" : "Open desk"}</a>
        </div>
      </article>`;
    })
    .join("");

  const main = `
    <section class="hero">
      <div>
        <p class="kicker">Commercial desk on TradesQuest</p>
        <h1>Play becomes a record <em>a person</em> can confirm.</h1>
      </div>
      <aside>
        <p class="lede drop">QuestSignal runs a learner’s quest evidence through four specialist agents. You get a skills profile, a proposed employer shortlist, and a public page built from quotations and citations. XP stays on the game card.</p>
      </aside>
    </section>
    ${sourceBanner(health)}
    <p class="eyebrow">How the desk works</p>
    <div class="steps">
      <div class="step-card"><b>Watch the agents <sup>01</sup></b><p class="meta">Assessor, Coach, Matcher, and GEO Publisher log their inputs and outputs.</p></div>
      <div class="step-card"><b>Confirm the draft <sup>02</sup></b><p class="meta">A person does this. Until then, nothing is called hire-ready.</p></div>
      <div class="step-card"><b>Open the outputs <sup>03</sup></b><p class="meta">Profile, employer shortlist, and the public page.</p></div>
    </div>
    <p class="eyebrow">The apprentices</p>
    <div class="grid">${people}</div>`;
  return layout({
    title: "QuestSignal",
    description: "A commercial desk that turns labeled TradesQuest fixture evidence into a reviewer-confirmed skills record.",
    health,
    main,
  });
}

function reviewerField() {
  return `<div class="fields">
          <label>Your name, as reviewer (optional) <input name="reviewer" maxlength="60" autocomplete="name"></label>
        </div>`;
}

export function renderDesk(packet) {
  const { apprentice, assessment, matching, health, steps } = packet;
  const confirmed = packet.confirmation;
  const label = reviewLabel(confirmed, assessment.clearsDraftBar);
  const top = matching.topCraft;
  const confirmBlock = confirmed
    ? `<form method="post" action="/desk/${esc(apprentice.id)}/reset" class="panel confirm done ${label.tone === "hold" ? "hold" : ""}">
        <p class="kicker">Step 05 · The human step</p>
        <p>${chip(label)} Confirmed by ${esc(confirmed.by)} at ${esc(confirmed.at)}.</p>
        <p class="meta">Your review is kept in this browser only, so every visitor runs the human step themselves.</p>
        <button class="btn ghost" type="submit">Return to draft</button>
      </form>`
    : `<form method="post" action="/desk/${esc(apprentice.id)}/confirm" class="panel confirm" id="confirm">
        <p class="kicker">Step 05 · A person, not an agent</p>
        <h2>Human step</h2>
        <p>The agents drafted this record. Confirm it as the reviewer. ${
          assessment.clearsDraftBar
            ? "The evidence bar is cleared, so confirmation is what allows the words hire-ready, and only as a supplement to time on a job."
            : "The evidence bar is still open, so confirmation keeps this draft in training."
        }</p>
        ${reviewerField()}
        <button class="btn primary" type="submit">Confirm this draft as reviewer</button>
      </form>`;
  const agents = steps
    .map((step, index) => agentCard(step, index, step.id === "coach" ? coachScript(apprentice.id, packet.coaching) : ""))
    .join("");
  const main = `
    <header class="page-head">
      <p class="kicker">Agent run · sample apprentice</p>
      <h1>${esc(apprentice.name)}</h1>
      <p class="lede">${esc(apprentice.specialty)} in ${esc(apprentice.city)}. ${esc(assessment.summary)}</p>
      <div class="chips">${chip(label)}<span class="chip plain">Fixture</span><span class="chip plain">Game XP ${apprentice.xp.toLocaleString("en-US")}</span></div>
    </header>
    ${sourceStrip(health)}
    <p class="run-state">Four specialist agents, in order. Each one logs its input and output. Scores and rankings are rules; the Coach script may be model-written and is checked against the evidence.</p>
    ${agents}
    ${confirmBlock}
    <p class="eyebrow">The outputs</p>
    <div class="results">
      <a class="card" href="/profiles/${esc(apprentice.id)}"><span class="num">01.</span><h3>Skills profile</h3><p class="meta">Fit, confidence, mentor, task variety, and the quest scores.</p><span class="btn">Open</span></a>
      <a class="card" href="/employers/${esc(top ? top.employerId : "bayline-electric")}?highlight=${esc(apprentice.id)}"><span class="num">02.</span><h3>Employer shortlist</h3><p class="meta">${top ? `${esc(top.name)} is the proposed craft desk at ${top.score}.` : "Open the proposed order."} A recruiter confirms it.</p><span class="btn">Open</span></a>
      <a class="card" href="/p/${esc(apprentice.id)}"><span class="num">03.</span><h3>Public GEO page</h3><p class="meta">Quotations, citations, JSON-LD, and llms.txt.</p><span class="btn">Open</span></a>
    </div>
    <script>
      const steps = [...document.querySelectorAll(".agent")];
      const results = document.querySelector(".results");
      const state = document.querySelector(".run-state");
      const motion = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      steps.forEach((step, i) => {
        setTimeout(() => {
          steps.forEach((other) => other.classList.remove("active"));
          step.classList.add("active");
          if (state) state.textContent = "Running " + step.dataset.agent + ".";
          step.scrollIntoView({ block: "nearest", behavior: motion });
        }, 400 + i * 900);
      });
      if (results) setTimeout(() => {
        steps.forEach((other) => other.classList.remove("active"));
        results.classList.add("ready");
        if (state) state.textContent = "Draft is ready for a person to confirm.";
      }, 400 + steps.length * 900);
    </script>
    ${COACH_SCRIPT}`;
  return layout({
    title: `${apprentice.name} · QuestSignal`,
    description: assessment.summary,
    health,
    main,
    play: true,
  });
}

export function renderProfile(packet, health) {
  const { apprentice, assessment, coaching, matching, hireReady } = packet;
  const label = reviewLabel(packet.confirmation, assessment.clearsDraftBar);
  const bars = assessment.competencies
    .map(
      (row) => `<div class="comp">
        <p class="comp-head"><strong>${esc(row.label)}</strong> <span class="score"><b>${row.score}</b>/100</span></p>
        <p class="cite">${row.quests.length ? esc(row.quests.map((quest) => quest.id).join(", ")) : "no quest"}</p>
        <div class="bar" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, row.score))}%"></span></div>
        ${row.quests.map((quest) => `<p class="meta">“${esc(quest.evidence)}”</p>`).join("")}
      </div>`,
    )
    .join("");
  const quests = coaching.nextQuests
    .map(
      (quest) => `<li><strong>${esc(quest.id)}</strong> ${esc(quest.title)} (${quest.hours}h) — ${esc(quest.why)}</li>`,
    )
    .join("");
  const plan = coaching.plan.map((line) => `<li>${esc(line)}</li>`).join("");
  const top = matching.topCraft;
  const headline = hireReady
    ? `Hire-ready, because a reviewer (${packet.confirmation.by}) confirmed this draft. It supplements time on a job.`
    : packet.confirmation
      ? "A reviewer kept this draft in training. It is not called hire-ready."
      : "Draft skills profile. A person confirms it on the desk before it is called hire-ready.";
  const main = `
    <header class="page-head">
      <p class="kicker">Skills profile · ${esc(packet.sourceLabel)}</p>
      <h1>${esc(apprentice.name)}</h1>
      <p class="lede">${esc(headline)}</p>
      <div class="chips">${chip(label)}<span class="chip plain">${esc(apprentice.specialty)}</span><span class="chip plain">${esc(apprentice.city)}</span></div>
    </header>
    ${sourceStrip(health)}
    <div class="split">
      <section class="panel">
        <h2>Draft signal ${assessment.signalScore}/100</h2>
        <p>${esc(assessment.summary)} Scores were taken immediately after each scenario. Invented competencies: none.</p>
        ${bars}
      </section>
      <section class="panel">
        <h2>What surveys tie to staying</h2>
        <dl class="facts">
          <div><dt>Fit</dt><dd>${esc(assessment.persistence.fit)}</dd></div>
          <div><dt>Confidence</dt><dd>“${esc(assessment.persistence.selfEfficacy)}” <span class="meta">${esc(assessment.persistence.selfEfficacySource)}</span></dd></div>
          <div><dt>Mentor</dt><dd>${esc(assessment.persistence.mentor)}</dd></div>
          <div><dt>Task variety</dt><dd>${esc(assessment.persistence.taskVariety.join(", "))}</dd></div>
          <div><dt>Session note</dt><dd>${esc(assessment.persistence.sessionNote)}</dd></div>
          <div><dt>Game XP</dt><dd>${apprentice.xp.toLocaleString("en-US")}. Left out of the signal.</dd></div>
        </dl>
      </section>
    </div>
    <section class="panel">
      <h2>Coach</h2>
      ${coachScript(apprentice.id, coaching)}
      <h3>Next quests</h3>
      <ul>${quests || "<li>No gap quest on the catalog.</li>"}</ul>
      <h3>Plan</h3>
      <ol>${plan}</ol>
    </section>
    <div class="actions end">
      <a class="btn" href="/desk/${esc(apprentice.id)}">Back to the agents</a>
      <a class="btn primary" href="/employers/${esc(top ? top.employerId : "bayline-electric")}?highlight=${esc(apprentice.id)}">Proposed shortlist</a>
      <a class="btn" href="/p/${esc(apprentice.id)}">Public page</a>
    </div>
    ${COACH_SCRIPT}`;
  return layout({
    title: `${apprentice.name} profile · QuestSignal`,
    description: headline,
    health,
    main,
  });
}

function typeName(type) {
  if (type === "workforce_board") return "Workforce board";
  if (type === "union") return "Union";
  return "Contractor";
}

export function renderShortlist({ health, boards, confirmations = {} }) {
  const blocks = boards
    .map((board) => {
      const rows = board.leaders
        .map((row) => {
          const label = reviewLabel(confirmations[row.apprenticeId], row.clearsDraftBar);
          return `<tr>
            <td>${row.rank}</td>
            <td><a href="/profiles/${esc(row.apprenticeId)}">${esc(row.name)}</a><div class="meta">${esc(row.trade)} · ${esc(row.city)}</div></td>
            <td>${row.signalScore}</td>
            <td>${row.xp.toLocaleString("en-US")}</td>
            <td>${row.proposed ? "Proposed" : "Hold"}</td>
            <td>${chip(label)}</td>
          </tr>`;
        })
        .join("");
      const contrast = board.contrast
        ? `<p class="meta">${esc(board.contrast.xpLeader.name)} leads game XP at ${board.contrast.xpLeader.xp.toLocaleString("en-US")}. The proposed order starts with ${esc(board.contrast.deskLeader.name)}. A recruiter confirms it.</p>`
        : "";
      return `<section class="panel">
        <p class="kicker">${esc(typeName(board.employer.type))} · sample</p>
        <h2><a href="/employers/${esc(board.employer.id)}">${esc(board.employer.name)}</a></h2>
        <p>${esc(board.employer.summary)} ${esc(board.employer.openings)} · ${esc(board.employer.city)}.</p>
        ${contrast}
        <div class="table-wrap"><table>
          <thead><tr><th>Order</th><th>Apprentice</th><th>Signal</th><th>Game XP</th><th>Proposal</th><th>Review</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </section>`;
    })
    .join("");
  const main = `
    <header class="page-head">
      <p class="kicker">Employer shortlist</p>
      <h1>A proposed order, <em>waiting on a person.</em></h1>
      <p class="lede">Matcher ranks sample candidates from quest evidence, the safety scenario, and city. Game XP is on the table and out of the formula. A recruiter confirms the order. Hire-ready appears only after a reviewer confirms a draft that cleared the evidence bar.</p>
    </header>
    ${sourceStrip(health)}
    ${blocks}`;
  return layout({
    title: "Employer shortlist · QuestSignal",
    description: "Proposed candidate order for sample employers. A recruiter confirms it.",
    health,
    main,
  });
}

export function renderEmployer({ health, board, highlight, confirmations = {} }) {
  const rows = board.rows
    .map((row) => {
      const label = reviewLabel(confirmations[row.apprenticeId], row.clearsDraftBar);
      return `<tr class="${row.apprenticeId === highlight ? "mark" : ""}">
        <td>${row.rank}</td>
        <td><a href="/desk/${esc(row.apprenticeId)}">${esc(row.name)}</a><div class="meta">${esc(row.reasons.slice(0, 2).join(" "))}</div></td>
        <td>${esc(row.trade)}</td>
        <td>${row.signalScore}</td>
        <td>${esc(row.safetyGate)}</td>
        <td>${row.matchScore}</td>
        <td>${row.xp.toLocaleString("en-US")}</td>
        <td>${row.proposed ? "Proposed" : "Hold"}</td>
        <td>${chip(label)}</td>
      </tr>`;
    })
    .join("");
  const contrast = board.contrast
    ? `<p class="lede">${esc(board.contrast.xpLeader.name)} has the higher game XP (${board.contrast.xpLeader.xp.toLocaleString("en-US")}). ${esc(board.contrast.deskLeader.name)} leads the proposed order because the evidence bar cleared. The safety result is one scenario, measured right after it. A recruiter confirms this list.</p>`
    : "";
  const main = `
    <header class="page-head">
      <p class="kicker">${esc(typeName(board.employer.type))} · sample employer</p>
      <h1>${esc(board.employer.name)}</h1>
      <p>${esc(board.employer.summary)}</p>
      <p class="meta">${esc(board.employer.openings)} · ${esc(board.employer.city)}, ${esc(board.employer.region)} · ${esc(board.sourceLabel)}</p>
    </header>
    ${contrast ? `<div class="quote">${contrast}</div>` : ""}
    ${sourceStrip(health)}
    <p class="eyebrow">Proposed order</p>
    <div class="table-wrap wide"><table>
      <thead><tr><th>#</th><th>Apprentice</th><th>Trade</th><th>Signal</th><th>Safety scenario</th><th>Match</th><th>Game XP</th><th>Proposal</th><th>Review</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="actions end"><a class="btn ghost" href="/employers">All desks</a></p>`;
  return layout({
    title: `${board.employer.name} · QuestSignal`,
    description: `Proposed candidates for ${board.employer.name}.`,
    health,
    main,
  });
}

export function renderPublic(packet, origin, health) {
  const { apprentice, assessment, geo } = packet;
  const label = reviewLabel(packet.confirmation, assessment.clearsDraftBar);
  const pageUrl = `${origin}${geo.path}`;
  const quotes = geo.quotations
    .map(
      (quote) => `<blockquote class="quote">“${esc(quote.text)}”<p class="meta">${esc(quote.label)} · cite quest ${esc(quote.questId)}</p></blockquote>`,
    )
    .join("");
  const evidence = geo.citations
    .map((row) => {
      const quote = assessment.competencies
        .find((item) => item.label === row.competency)
        ?.quests[0];
      return `<tr id="q-${esc(row.questIds[0])}">
        <td>${esc(row.competency)}</td>
        <td>${quote ? `“${esc(quote.evidence)}”` : ""}</td>
        <td>${row.score}</td>
        <td>${esc(row.questIds.join(", "))}</td>
        <td>${esc(row.measured)}</td>
      </tr>`;
    })
    .join("");
  const facts = geo.facts.map((fact) => `<li>${esc(fact)}</li>`).join("");
  const main = `
    <header class="page-head">
      <p class="kicker">Public profile · GEO Publisher</p>
      <h1>${esc(apprentice.name)}</h1>
      <p class="lede">${esc(geo.facts[0])} ${esc(geo.facts[1])}</p>
      <div class="chips">${chip(label)}<span class="chip plain">Supplements time on a job</span></div>
    </header>
    ${quotes}
    <div class="section-head"><h2 id="evidence">Evidence a reader can check</h2></div>
    <p class="meta">Each row is a fixture quest. The quotation is the scenario note. The citation is the quest ID, scored immediately afterward. Issuer: QuestSignal demo desk. Verify on this page.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Task</th><th>Quotation</th><th>Score</th><th>Citation</th><th>When measured</th></tr></thead>
      <tbody>${evidence}</tbody>
    </table></div>
    <div class="section-head"><h2>Facts</h2></div>
    <ol class="ledger">${facts}</ol>
    <div class="section-head"><h2>Machine-readable</h2></div>
    <p><a href="${esc(geo.llmsPath)}">llms.txt</a> · JSON-LD is in the page source and below.</p>
    <div class="machine">
      <details open>
        <summary>JSON-LD</summary>
        <pre class="code" tabindex="0">${jsonBlock(geo.jsonLd)}</pre>
      </details>
      <details open>
        <summary>llms.txt</summary>
        <pre class="code" tabindex="0">${esc(geo.llmsTxt)}</pre>
      </details>
    </div>
    <p class="meta">This page is specific and sourced. It does not promise that an answer engine will cite it.</p>
    <p class="actions end"><a class="btn" href="/desk/${esc(apprentice.id)}">Back to the commercial desk</a></p>`;
  return layout({
    title: `${apprentice.name} · public profile`,
    description: geo.facts[0],
    health,
    main,
    extraHead: `<link rel="canonical" href="${esc(pageUrl)}">
      <link rel="alternate" type="text/plain" href="${esc(pageUrl)}/llms.txt" title="llms.txt">
      <script type="application/ld+json">${jsonLd(geo.jsonLd)}</script>`,
  });
}

export function renderNotFound(health) {
  return layout({
    title: "Not found · QuestSignal",
    description: "That page is not in the demo.",
    health,
    main: `<section class="lost">
      <p class="kicker">Page not found</p>
      <p class="code-num" aria-hidden="true">404.</p>
      <h1>Not on this desk</h1>
      <p class="lede">That page is not in the demo.</p>
      <p class="actions"><a class="btn primary" href="/">Back to the apprentices</a></p>
    </section>`,
  });
}
