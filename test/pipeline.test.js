import test from "node:test";
import assert from "node:assert/strict";
import { createTradesQuestClient } from "../src/tradesquest/client.js";
import { apprentices, employers, rubrics } from "../src/data/fixture.js";
import { assess } from "../src/agents/assessor.js";
import { publish } from "../src/agents/geo.js";
import { runDesk, buildEmployerBoard } from "../src/agents/run.js";
import { reviewRow } from "../src/review/cookie.js";
import { renderPublic, renderProfile } from "../src/http/render.js";

const client = createTradesQuestClient({
  fixture: { apprentices, employers },
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        status: "healthy",
        environment: "production",
        timestamp: "2026-10-07T20:00:00.000Z",
      }),
  }),
});

function banned(text) {
  assert.doesNotMatch(text, /injur/i);
  assert.doesNotMatch(text, /licens/i);
  assert.doesNotMatch(text, /degree-free/i);
  assert.doesNotMatch(text, /30\s*[–-]?\s*40|41%|citation lift|wage premium/i);
}

test("draft signals leave XP out and wait for a person", () => {
  const maya = assess(apprentices.find((row) => row.id === "maya-chen"), rubrics.Electrician);
  const devon = assess(apprentices.find((row) => row.id === "devon-brooks"), rubrics.Electrician);
  assert.equal(maya.signalScore, 86);
  assert.equal(maya.clearsDraftBar, true);
  assert.equal(devon.signalScore, 76);
  assert.equal(devon.clearsDraftBar, false);
  assert.equal(devon.safetyGate, "fail");
  assert.ok(devon.xp > maya.xp);
  assert.deepEqual(maya.output.inventedCompetencies, []);
  assert.equal(maya.output.review, "awaiting a person");
  assert.match(maya.persistence.fit, /Inside wire/);
  assert.equal(maya.persistence.mentorConnected, true);
  assert.equal(devon.persistence.mentorConnected, false);
  assert.ok(maya.persistence.taskVariety.length >= 4);
});

test("Bayline proposes Maya ahead of the XP leader", () => {
  const board = buildEmployerBoard("bayline-electric");
  const maya = board.rows.find((row) => row.apprenticeId === "maya-chen");
  const devon = board.rows.find((row) => row.apprenticeId === "devon-brooks");
  assert.ok(maya.rank < devon.rank);
  assert.equal(maya.proposed, true);
  assert.equal(devon.proposed, false);
  assert.equal(board.contrast.xpLeader.apprenticeId, "devon-brooks");
  assert.equal(board.contrast.deskLeader.apprenticeId, "maya-chen");
});

test("public copy stays inside the claim limits", async () => {
  const maya = apprentices.find((row) => row.id === "maya-chen");
  const assessment = assess(maya, rubrics.Electrician);
  const draft = publish(maya, assessment, "http://127.0.0.1:4173/p/maya-chen", null);
  assert.equal(draft.confirmedRecord, false);
  assert.match(draft.llmsTxt, /not called hire-ready/);
  assert.ok(draft.quotations.length >= 1);
  assert.ok(draft.citations.length >= 4);
  banned(draft.llmsTxt);

  const confirmation = reviewRow(true, "Demo reviewer", "2026-10-07T20:00:00.000Z");
  assert.equal(confirmation.decision, "confirm-record");
  const confirmed = publish(maya, assessment, "http://127.0.0.1:4173/p/maya-chen", confirmation);
  assert.equal(confirmed.confirmedRecord, true);
  assert.match(confirmed.llmsTxt, /hire-ready/);
  assert.match(confirmed.llmsTxt, /supplements time on a job/);
  banned(confirmed.llmsTxt);

  const devonHold = reviewRow(false, "Demo reviewer", "2026-10-07T20:01:00.000Z");
  assert.equal(devonHold.decision, "keep-in-training");
});

test("desk run uses the health client and four roles", async () => {
  const packet = await runDesk("maya-chen", client, "http://127.0.0.1:4173/p/maya-chen", null);
  assert.equal(packet.health.live, true);
  assert.equal(packet.source, "fixture");
  assert.deepEqual(
    packet.steps.map((step) => step.id),
    ["assessor", "coach", "matcher", "geo"],
  );
  assert.equal(packet.coaching.nextQuests[0].id, "Q-E-055");
  assert.equal(packet.matching.topCraft.employerId, "bayline-electric");
});

test("rendered pages do not call a record hire-ready before confirmation", async () => {
  const packet = await runDesk("maya-chen", client, "http://127.0.0.1:4173/p/maya-chen", null);
  const html = renderPublic(
    { ...packet, sourceLabel: packet.sourceLabel },
    "http://127.0.0.1:4173",
    packet.health,
  );
  assert.match(html, /Draft · awaiting a person/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /Q-S-003/);
  assert.doesNotMatch(html, /Hire-ready · reviewer confirmed/);
  banned(html);

  const profile = renderProfile(
    {
      apprentice: packet.apprentice,
      assessment: packet.assessment,
      coaching: packet.coaching,
      matching: packet.matching,
      confirmation: { decision: "confirm-record", at: "2026-10-07T20:02:00.000Z", by: "Demo reviewer" },
      hireReady: true,
      sourceLabel: packet.sourceLabel,
    },
    packet.health,
  );
  assert.match(profile, /Hire-ready, because a reviewer \(Demo reviewer\) confirmed this draft/);
  assert.match(profile, /supplements time on a job/);
  banned(profile);
});
