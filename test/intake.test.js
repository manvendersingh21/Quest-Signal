import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.OPENAI_API_KEY;
delete process.env.BLOB_READ_WRITE_TOKEN;

const { handler } = await import("../src/http/app.js");
const { recordStoreKind, isRecordId } = await import("../src/records/store.js");
const { questCatalog, rubrics } = await import("../src/data/fixture.js");

const VISITOR = /Entered by a visitor\. Not verified by TradesQuest\./;
const FIXTURE = /demo fixture|fixture card|fixture quest/i;

function banned(text) {
  assert.doesNotMatch(text, /injur/i);
  assert.doesNotMatch(text, /licens/i);
  assert.doesNotMatch(text, /degree-free/i);
  assert.doesNotMatch(text, /30\s*[–-]?\s*40|41%|citation lift|wage premium/i);
}

async function withServer(run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    server.close();
  }
}

function post(base, path, body, cookie = "") {
  return fetch(`${base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", cookie },
    body: typeof body === "string" ? body : new URLSearchParams(body),
  });
}

const get = (base, path, cookie = "") => fetch(`${base}${path}`, { headers: { cookie } });
const cookieOf = (response) => response.headers.get("set-cookie").split(";")[0];

// A full Plumber rubric, every row at or above the bar, so confirm can reach hire-ready.
const RECORD = {
  name: "Rosa Test",
  trade: "Plumber",
  specialty: "Service plumber",
  city: "Fresno",
  region: "Central Valley",
  fit: "Plumbing is the path she chose. She asks to repeat rough-in work.",
  selfEfficacy: "I can set a trap arm at the right height.",
  mentor: "J. Ortiz",
  taskVariety: "Trench safety, DWV rough-in, Fixture trim, Drain grade, Isometrics",
  permission: "yes",
  competency_0: "safety",
  title_0: "Trench entry check",
  score_0: "90",
  evidence_0: "Checked the shoring and atmosphere before entering the trench.",
  competency_1: "plumbing_rough",
  title_1: "DWV rough-in",
  score_1: "85",
  evidence_1: "Set the closet flange and vent at the printed heights.",
  competency_2: "fixtures",
  title_2: "Kitchen sink trim",
  score_2: "84",
  evidence_2: "Trimmed a kitchen sink with no leak at the slip nuts.",
  competency_3: "drain",
  title_3: "Drain grade",
  score_3: "82",
  evidence_3: "Held a quarter inch per foot across the full run.",
  competency_4: "blueprint",
  title_4: "Isometric read",
  score_4: "80",
  evidence_4: "Traced the waste stack from the iso to each fixture.",
};

test("every rubric competency has a catalog quest", () => {
  for (const [trade, rubric] of Object.entries(rubrics)) {
    for (const slot of rubric) assert.ok(questCatalog[slot.id], `${trade}: ${slot.id}`);
  }
});

test("coach skips a gap with no catalog quest instead of failing", async () => {
  const { apprentices } = await import("../src/data/fixture.js");
  const { assess } = await import("../src/agents/assessor.js");
  const { coach } = await import("../src/agents/coach.js");
  const priya = apprentices.find((row) => row.id === "priya-shah");
  const assessment = assess(priya, rubrics.HVAC);
  const out = coach(priya, assessment, { safety: questCatalog.safety });
  assert.deepEqual(out.nextQuests, []);
});

test("records fall back to process memory without the Blob token", () => {
  assert.equal(recordStoreKind(), "memory");
});

test("a visitor record runs through all four outputs, labeled and unindexed", async () => {
  await withServer(async (base) => {
    const form = await get(base, "/new");
    assert.equal(form.status, 200);
    assert.match(await form.text(), /I have this apprentice&#39;s permission|I have this apprentice's permission/);

    const created = await post(base, "/new", RECORD);
    assert.equal(created.status, 303);
    const location = created.headers.get("location");
    const id = location.replace("/desk/", "");
    assert.ok(isRecordId(id), location);

    for (const path of [`/desk/${id}`, `/profiles/${id}`, `/p/${id}`]) {
      const response = await get(base, path);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get("x-robots-tag"), "noindex", path);
      const html = await response.text();
      assert.match(html, VISITOR, path);
      assert.doesNotMatch(html, FIXTURE, path);
      assert.match(html, /<meta name="robots" content="noindex">/, path);
      assert.match(html, /Rosa Test/, path);
      assert.doesNotMatch(html, /Hire-ready · reviewer confirmed|Hire-ready, because/, path);
      banned(html);
    }

    const pub = await (await get(base, `/p/${id}`)).text();
    assert.match(pub, /application\/ld\+json/);
    assert.match(pub, /V-001/);
    assert.match(pub, /"creditText":"Entered by a visitor\. Not verified by TradesQuest\."/);

    const llms = await get(base, `/p/${id}/llms.txt`);
    assert.equal(llms.status, 200);
    assert.equal(llms.headers.get("x-robots-tag"), "noindex");
    const text = await llms.text();
    assert.match(text, VISITOR);
    assert.doesNotMatch(text, FIXTURE);
    assert.match(text, /not called hire-ready/);
    banned(text);

    const api = await (await get(base, `/api/desk/${id}`)).json();
    assert.equal(api.source, "visitor");
    assert.match(api.sourceLabel, VISITOR);
    assert.doesNotMatch(JSON.stringify(api), FIXTURE);

    const coach = await (await get(base, `/api/coach/${id}`)).json();
    assert.equal(coach.writer.source, "rules");

    // The record joins the employer view only when its link is in the URL.
    const board = await (await get(base, `/employers/mission-pipe-union?highlight=${id}`)).text();
    assert.match(board, /Rosa Test/);
    assert.doesNotMatch(await (await get(base, "/employers/mission-pipe-union")).text(), /Rosa Test/);

    // Kept out of the sitemap and root llms.txt.
    assert.doesNotMatch(await (await get(base, "/sitemap.xml")).text(), new RegExp(id));
    assert.doesNotMatch(await (await get(base, "/llms.txt")).text(), new RegExp(id));

    // The human step works for a visitor record, and only for this visitor.
    const confirmed = await post(base, `/desk/${id}/confirm`, { reviewer: "Ana" });
    assert.equal(confirmed.status, 303);
    assert.equal(confirmed.headers.get("location"), `/profiles/${id}`);
    const mine = cookieOf(confirmed);
    assert.match(await (await get(base, `/profiles/${id}`, mine)).text(), /Hire-ready, because a reviewer \(Ana\) confirmed/);
    assert.match(await (await get(base, `/p/${id}/llms.txt`, mine)).text(), /A reviewer confirmed this draft/);
    assert.doesNotMatch(await (await get(base, `/profiles/${id}`)).text(), /Hire-ready, because/);
  });
});

test("an unknown record id is a 404", async () => {
  await withServer(async (base) => {
    assert.equal((await get(base, "/desk/r-000000000000")).status, 404);
    assert.equal((await get(base, "/p/r-000000000000/llms.txt")).status, 404);
    assert.equal((await post(base, "/desk/r-000000000000/confirm", {})).status, 404);
  });
});

test("validation errors re-render the form with values kept", async () => {
  await withServer(async (base) => {
    const bad = {
      ...RECORD,
      permission: "",
      competency_1: "conduit",
      score_2: "140",
      evidence_3: "Is a licensed plumber now.",
    };
    const response = await post(base, "/new", bad);
    assert.equal(response.status, 400);
    const html = await response.text();
    assert.match(html, /things to fix/);
    assert.match(html, /permission to publish/);
    assert.match(html, /Choose a Plumber competency/);
    assert.match(html, /Score is a whole number from 0 to 100/);
    assert.match(html, /Leave out claims about a license/);
    assert.match(html, /value="Rosa Test"/);
    assert.match(html, /value="140"/);

    const short = { ...RECORD };
    for (const i of [1, 2, 3, 4]) {
      for (const key of ["competency", "title", "score", "evidence"]) delete short[`${key}_${i}`];
    }
    const tooFew = await post(base, "/new", short);
    assert.equal(tooFew.status, 400);
    assert.match(await tooFew.text(), /Enter 3 to 8 quest evidence rows/);
  });
});

test("an oversized form is refused with 413", async () => {
  await withServer(async (base) => {
    const body = new URLSearchParams({ ...RECORD, fit: "x".repeat(40 * 1024) }).toString();
    const response = await post(base, "/new", body);
    assert.equal(response.status, 413);
  });
});
