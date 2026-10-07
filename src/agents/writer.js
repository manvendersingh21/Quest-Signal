import { createHash } from "node:crypto";

/**
 * Coach writer. With OPENAI_API_KEY set, a model rewrites the Coach headline and
 * interview script from the quest evidence the rules already selected.
 * Scores, gaps, ranking, and the review gate stay rule-based.
 *
 * Every model reply is checked before it is shown. A quotation must match quest
 * evidence word for word, every cited quest ID must be on file, and the claim
 * limits hold. Anything that fails, or no key, keeps the rule-based text.
 */

export const BANNED = [
  /hire-?ready/i,
  /injur/i,
  /licens/i,
  /certif/i,
  /degree-free/i,
  /guarantee/i,
  /\bwage\b|\bsalary\b/i,
  /citation lift/i,
  /\d+\s*%/,
];

const SYSTEM = `You are the Coach on QuestSignal, a desk that turns trade-apprentice quest evidence into a draft skills record.
Write for a mentor preparing an apprentice for an employer conversation. Plain, specific, short sentences.
Rules:
- Use only the facts in the JSON you are given. Do not invent skills, employers, numbers, or outcomes.
- Every quotation must be copied exactly from a quest "evidence" string, inside “curly quotes”, and cite its quest ID (e.g. Q-S-003).
- Game XP is not evidence of skill. Do not use it.
- Never say hire-ready, certified, licensed, guaranteed, or anything about injuries, wages, or percentages. A person confirms the draft later.
- If the safety scenario failed or the evidence bar is open, say the draft stays in training.
Return JSON: {"headline": string (1-2 sentences), "interviewPoints": string[] (3-4 items, each quoting one piece of evidence or a persistence field)}`;

function brief(apprentice, assessment, coaching) {
  return {
    name: apprentice.name,
    trade: apprentice.trade,
    specialty: apprentice.specialty,
    draftSignal: assessment.signalScore,
    evidenceBar: assessment.clearsDraftBar ? "cleared" : "open",
    safetyScenario: assessment.safetyGate,
    competencies: assessment.competencies.map((row) => ({
      label: row.label,
      score: row.score,
      quests: row.quests.map((quest) => ({ id: quest.id, evidence: quest.evidence })),
    })),
    gaps: assessment.gaps.map((gap) => `${gap.label}: ${gap.reason}`),
    persistence: {
      fit: assessment.persistence.fit,
      confidence: assessment.persistence.selfEfficacy,
      mentor: assessment.persistence.mentorConnected ? assessment.persistence.mentor : "none on file",
      taskVariety: assessment.persistence.taskVariety,
    },
    nextQuests: coaching.nextQuests.map((quest) => `${quest.id} ${quest.title}`),
  };
}

/** @returns {string[]} problems; empty means the reply may be shown. */
export function checkWritten(written, assessment) {
  const problems = [];
  if (!written || typeof written.headline !== "string" || !Array.isArray(written.interviewPoints)) {
    return ["Reply was not the expected shape."];
  }
  if (written.interviewPoints.length < 2 || written.interviewPoints.length > 5) problems.push("Wrong number of interview points.");
  const quests = assessment.competencies.flatMap((row) => row.quests);
  const ids = new Set(quests.map((quest) => quest.id));
  const persistenceText = [assessment.persistence.fit, assessment.persistence.selfEfficacy, assessment.persistence.sessionNote]
    .filter(Boolean)
    .join(" ");
  const sources = quests.map((quest) => quest.evidence).join(" ") + " " + persistenceText;
  const text = [written.headline, ...written.interviewPoints].join("\n");
  for (const pattern of BANNED) if (pattern.test(text)) problems.push(`Claim limit: ${pattern}`);
  for (const id of text.match(/\bQ-[A-Z]+-\d+\b/g) || []) if (!ids.has(id)) problems.push(`Unknown quest ${id}.`);
  for (const [, quote] of text.matchAll(/[“"]([^”"]{8,})[”"]/g)) {
    if (!sources.includes(quote.trim().replace(/[.,]$/, ""))) problems.push(`Quotation not on file: ${quote.slice(0, 40)}`);
  }
  if (!/\bQ-[A-Z]+-\d+\b/.test(text)) problems.push("No quest is cited.");
  return problems;
}

export function writerConfig() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return {
    key,
    model: process.env.OPENAI_MODEL || "gpt-5-mini",
    baseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
  };
}

async function callModel(config, payload, fetchImpl) {
  const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: JSON.stringify(payload) },
      ],
    }),
    signal: AbortSignal.timeout(25000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || `Model call failed (${response.status}).`);
  return JSON.parse(body.choices?.[0]?.message?.content || "null");
}

/**
 * Returns coaching with a `writer` record. When the model's text passes the checks,
 * headline and interviewPoints are replaced; otherwise the rule-based text stays.
 */
export async function writeCoaching(apprentice, assessment, coaching, { cache, fetchImpl = fetch } = {}) {
  const config = writerConfig();
  if (!config) return { ...coaching, writer: { source: "rules", note: "No model key. Rule-based text." } };

  const payload = brief(apprentice, assessment, coaching);
  const key = `coach:${config.model}:${createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16)}`;
  let record = cache ? await cache.get(key).catch(() => null) : null;

  if (!record) {
    try {
      const written = await callModel(config, payload, fetchImpl);
      const problems = checkWritten(written, assessment);
      record = problems.length
        ? { source: "rules", model: config.model, note: `Model text failed checks: ${problems.join(" ")}` }
        : {
            source: "model",
            model: config.model,
            headline: written.headline.trim(),
            interviewPoints: written.interviewPoints.map((point) => String(point).trim()),
            note: "Model text passed the quotation, citation, and claim checks.",
          };
      if (cache) await cache.set(key, record).catch(() => {});
    } catch (error) {
      // Transient failures are not cached, so the next request retries.
      return {
        ...coaching,
        writer: { source: "rules", model: config.model, note: `Model call failed: ${error.message}` },
      };
    }
  }

  const log = [
    ...coaching.log,
    {
      phase: "work",
      text:
        record.source === "model"
          ? `${record.model} rewrote the headline and interview script. ${record.note}`
          : `Kept the rule-based script. ${record.note}`,
    },
  ];
  if (record.source !== "model") return { ...coaching, log, writer: record };
  return {
    ...coaching,
    headline: record.headline,
    interviewPoints: record.interviewPoints,
    log,
    output: { ...coaching.output, headline: record.headline, writtenBy: record.model },
    writer: record,
  };
}
