import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.OPENAI_API_KEY;

const { handler } = await import("../src/http/app.js");
const { storeKind } = await import("../src/agents/cache.js");

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

function post(base, path, fields, cookie = "") {
  return fetch(`${base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", cookie },
    body: new URLSearchParams(fields),
  });
}

const page = async (base, path, cookie = "") => (await fetch(`${base}${path}`, { headers: { cookie } })).text();
const cookieOf = (response) => response.headers.get("set-cookie").split(";")[0];

test("model cache falls back to memory without Redis env", () => {
  assert.equal(storeKind(), "memory");
});

test("a confirmation belongs to the visitor who made it", async () => {
  await withServer(async (base) => {
    const ok = await post(base, "/desk/maya-chen/confirm", { reviewer: "Ana" });
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.get("location"), "/profiles/maya-chen");
    const mine = cookieOf(ok);

    assert.match(await page(base, "/profiles/maya-chen", mine), /Hire-ready, because a reviewer \(Ana\) confirmed/);
    assert.match(await page(base, "/", mine), /Hire-ready · reviewer confirmed/);

    // Another visitor still gets the human step.
    assert.match(await page(base, "/desk/maya-chen"), /Confirm this draft as reviewer/);
    assert.doesNotMatch(await page(base, "/profiles/maya-chen"), /Hire-ready, because/);

    const reset = await post(base, "/desk/maya-chen/reset", {}, mine);
    assert.equal(reset.status, 303);
    assert.match(await page(base, "/desk/maya-chen", cookieOf(reset)), /Confirm this draft as reviewer/);
  });
});

test("an edited cookie is ignored, and cannot promote a draft under the bar", async () => {
  await withServer(async (base) => {
    const forged = `qs_review=${Buffer.from(JSON.stringify({ "maya-chen": { at: "x", by: "x", decision: "confirm-record" } })).toString("base64url")}.bad`;
    assert.doesNotMatch(await page(base, "/profiles/maya-chen", forged), /Hire-ready, because/);

    const devon = await post(base, "/desk/devon-brooks/confirm", { reviewer: "Ana" });
    assert.doesNotMatch(await page(base, "/profiles/devon-brooks", cookieOf(devon)), /Hire-ready, because/);
  });
});

test("public page uses the forwarded https origin", async () => {
  await withServer(async (base) => {
    const html = await (
      await fetch(`${base}/p/maya-chen`, {
        headers: { "x-forwarded-proto": "https", "x-forwarded-host": "questsignal.example" },
      })
    ).text();
    assert.match(html, /<link rel="canonical" href="https:\/\/questsignal\.example\/p\/maya-chen">/);
    const css = await fetch(`${base}/styles.css`);
    assert.equal(css.status, 200);
  });
});
