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
- The "status" field is decided by rules. Restate it; never contradict it. Gaps under the bar are next quests, not a reason to keep a cleared draft in training.
Return JSON: {"headline": string, "interviewPoints": string[]}
- headline: exactly 2 sentences a mentor would say. First, the strongest evidence-backed strength and the one thing to work on next (name the next quest if there is one). Second, the status in your own plain words. Do not write "Status:".
- interviewPoints: 3-4 items. Each starts with a short instruction to the apprentice (e.g. "Lead with lockout:") and then quotes one evidence string with its quest ID, or a persistence field.`;

function draftStatus(assessment) {
  if (assessment.safetyGate === "fail") return "Stays in training: the safety scenario failed.";
  if (!assessment.clearsDraftBar) return "Stays in training: the draft signal is under the evidence bar.";
  return "Evidence bar cleared. The draft goes to a person for review next.";
}

function brief(apprentice, assessment, coaching) {
  return {
    name: apprentice.name,
    trade: apprentice.trade,
    specialty: apprentice.specialty,
    status: draftStatus(assessment),
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
export function checkWritten(written, assessment, nextQuestIds = []) {
  const problems = [];
  if (!written || typeof written.headline !== "string" || !Array.isArray(written.interviewPoints)) {
    return ["Reply was not the expected shape."];
  }
  if (written.interviewPoints.length < 2 || written.interviewPoints.length > 5) problems.push("Wrong number of interview points.");
  const quests = assessment.competencies.flatMap((row) => row.quests);
  const ids = new Set([...quests.map((quest) => quest.id), ...nextQuestIds]);
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
  const training = /in training/i.test(text);
  if (assessment.clearsDraftBar && training) problems.push("Says the draft stays in training, but the evidence bar cleared.");
  if (!assessment.clearsDraftBar && !training) problems.push("Must say the draft stays in training.");
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

async function callModel(config, messages, fetchImpl) {
  const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      response_format: { type: "json_object" },
      ...(/^gpt-5/.test(config.model) ? { reasoning_effort: "minimal" } : {}),
      messages,
    }),
    signal: AbortSignal.timeout(25000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || `Model call failed (${response.status}).`);
  return JSON.parse(body.choices?.[0]?.message?.content || "null");
}

/** One attempt, then one repair attempt that names what failed the checks. */
async function draft(config, payload, assessment, nextQuestIds, fetchImpl) {
  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: JSON.stringify(payload) },
  ];
  let written = await callModel(config, messages, fetchImpl);
  let problems = checkWritten(written, assessment, nextQuestIds);
  if (problems.length) {
    messages.push(
      { role: "assistant", content: JSON.stringify(written) },
      {
        role: "user",
        content: `That reply failed these checks: ${problems.join(" ")} Rewrite it. Quote evidence strings exactly and cite only quest IDs present in the JSON (evidence quests or next quests).`,
      },
    );
    written = await callModel(config, messages, fetchImpl);
    problems = checkWritten(written, assessment, nextQuestIds);
  }
  return { written, problems };
}

const inflight = new Map();
const recentFailures = new Map();

/**
 * Returns coaching with a `writer` record. When the model's text passes the checks,
 * headline and interviewPoints are replaced; otherwise the rule-based text stays.
 */
export async function writeCoaching(
  apprentice,
  assessment,
  coaching,
  { cache, fetchImpl = fetch, cachedOnly = false } = {},
) {
  const config = writerConfig();
  if (!config) return { ...coaching, writer: { source: "rules", note: "No model key. Rule-based text." } };

  const payload = brief(apprentice, assessment, coaching);
  const key = `coach2:${config.model}:${createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16)}`;
  let record = cache ? await cache.get(key).catch(() => null) : null;
  // A reply that failed the checks is kept briefly, then the model gets another try.
  if (record?.retryAfter && Date.now() > record.retryAfter) record = null;

  if (!record && cachedOnly) {
    return { ...coaching, writer: { source: "pending", model: config.model, note: "Model script not written yet." } };
  }

  if (!record) {
    const failure = recentFailures.get(key);
    if (failure && Date.now() - failure.at < 60000) {
      return { ...coaching, writer: { source: "rules", model: config.model, note: failure.note } };
    }
    if (!inflight.has(key)) {
      inflight.set(
        key,
        (async () => {
          const { written, problems } = await draft(
            config,
            payload,
            assessment,
            coaching.nextQuests.map((quest) => quest.id),
            fetchImpl,
          );
          const value = problems.length
            ? {
                source: "rules",
                model: config.model,
                note: `Model text failed checks twice: ${problems.join(" ")}`,
                retryAfter: Date.now() + 10 * 60 * 1000,
              }
            : {
                source: "model",
                model: config.model,
                headline: written.headline.trim(),
                interviewPoints: written.interviewPoints.map((point) => String(point).trim()),
                note: "Model text passed the quotation, citation, and claim checks.",
                at: new Date().toISOString(),
              };
          if (cache) await cache.set(key, value).catch(() => {});
          return value;
        })().finally(() => inflight.delete(key)),
      );
    }
    try {
      record = await inflight.get(key);
    } catch (error) {
      // Transient failures are not cached in the store, so a later request retries.
      const note = `Model call failed: ${error.message}`;
      recentFailures.set(key, { at: Date.now(), note });
      return { ...coaching, writer: { source: "rules", model: config.model, note } };
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
