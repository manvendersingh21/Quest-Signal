import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;
process.env.REVIEWER_PASSCODE = "test-pass";

const { handler } = await import("../src/http/app.js");
const { clearConfirmations, storeKind } = await import("../src/review/store.js");

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

function post(base, path, fields) {
  return fetch(`${base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

test("store falls back to memory without Redis env", () => {
  assert.equal(storeKind(), "memory");
});

test("confirm needs the reviewer passcode, then shows on every page", async () => {
  await clearConfirmations();
  await withServer(async (base) => {
    const denied = await post(base, "/desk/maya-chen/confirm", { reviewer: "Ana", passcode: "nope" });
    assert.equal(denied.status, 403);
    assert.match(await denied.text(), /did not match/);
    assert.doesNotMatch(await (await fetch(`${base}/profiles/maya-chen`)).text(), /Hire-ready ·/);

    const ok = await post(base, "/desk/maya-chen/confirm", { reviewer: "Ana", passcode: "test-pass" });
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.get("location"), "/profiles/maya-chen");
    const profile = await (await fetch(`${base}/profiles/maya-chen`)).text();
    assert.match(profile, /Hire-ready, because a reviewer \(Ana\) confirmed/);
    assert.match(await (await fetch(`${base}/`)).text(), /Hire-ready · reviewer confirmed/);

    const reset = await post(base, "/desk/maya-chen/reset", { reviewer: "Ana", passcode: "test-pass" });
    assert.equal(reset.status, 303);
    assert.match(await (await fetch(`${base}/desk/maya-chen`)).text(), /Confirm this draft as reviewer/);
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
