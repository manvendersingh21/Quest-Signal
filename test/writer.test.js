import test from "node:test";
import assert from "node:assert/strict";
import { apprentices, rubrics, questCatalog } from "../src/data/fixture.js";
import { assess } from "../src/agents/assessor.js";
import { coach } from "../src/agents/coach.js";
import { writeCoaching, checkWritten } from "../src/agents/writer.js";

const maya = apprentices.find((row) => row.id === "maya-chen");
const assessment = assess(maya, rubrics.Electrician);
const coaching = coach(maya, assessment, questCatalog);
const realQuest = assessment.competencies.find((row) => row.quests.length).quests[0];

function stub(content) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  });
}

const good = {
  headline: "Maya's draft clears the evidence bar. A person reviews it next.",
  interviewPoints: [
    `Quote the scenario note: “${realQuest.evidence}” (${realQuest.id}).`,
    `Name the fit in her words: “${assessment.persistence.fit}”`,
  ],
};

test("no key keeps the rule-based script", async () => {
  delete process.env.OPENAI_API_KEY;
  const out = await writeCoaching(maya, assessment, coaching);
  assert.equal(out.writer.source, "rules");
  assert.equal(out.headline, coaching.headline);
});

test("model text that quotes evidence exactly is used", async () => {
  process.env.OPENAI_API_KEY = "test";
  const out = await writeCoaching(maya, assessment, coaching, { fetchImpl: stub(good) });
  assert.equal(out.writer.source, "model");
  assert.equal(out.headline, good.headline);
  assert.deepEqual(out.interviewPoints, good.interviewPoints);
  delete process.env.OPENAI_API_KEY;
});

test("invented quotes, unknown quests, and claim breaches fall back to rules", async () => {
  process.env.OPENAI_API_KEY = "test";
  const bad = [
    { ...good, headline: "Maya is hire-ready today." },
    { ...good, interviewPoints: [...good.interviewPoints, "Cite Q-Z-999 for panel work."] },
    { ...good, interviewPoints: ["Quote “she rewired the whole hospital overnight” (Q-S-003).", good.interviewPoints[1]] },
    { ...good, headline: "Safety work cut incidents by 40%." },
  ];
  for (const reply of bad) {
    assert.ok(checkWritten(reply, assessment).length > 0, JSON.stringify(reply));
    const out = await writeCoaching(maya, assessment, coaching, { fetchImpl: stub(reply) });
    assert.equal(out.writer.source, "rules");
    assert.equal(out.headline, coaching.headline);
  }
  delete process.env.OPENAI_API_KEY;
});

test("a failed model call keeps the rules and is not cached", async () => {
  process.env.OPENAI_API_KEY = "test";
  const store = new Map();
  const cache = { get: async (k) => store.get(k) ?? null, set: async (k, v) => store.set(k, v) };
  const out = await writeCoaching(maya, assessment, coaching, {
    cache,
    fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ error: { message: "boom" } }) }),
  });
  assert.equal(out.writer.source, "rules");
  assert.match(out.writer.note, /boom/);
  assert.equal(store.size, 0);
  delete process.env.OPENAI_API_KEY;
});
