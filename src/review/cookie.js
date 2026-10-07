import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Reviewer decisions live in the visitor's own signed cookie.
 * Each judge gets a clean run of the confirm step, and any server instance can
 * read it. The server still re-checks the evidence bar before saying hire-ready,
 * so an edited cookie cannot promote a draft that did not clear it.
 */

const NAME = "qs_review";
const MAX_ROWS = 12;
const DECISIONS = new Set(["confirm-record", "keep-in-training"]);

function secret() {
  return process.env.SESSION_SECRET || "questsignal-local-dev";
}

function sign(payload) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at > 0) out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return out;
}

/**
 * @param knownIds a Set of ids, or a function that says whether an id may hold a review
 *   (fixture ids and well-formed visitor record ids). The server still re-checks the
 *   evidence bar for the record before it says hire-ready.
 * @returns {Record<string, { at: string, by: string, decision: string }>}
 */
export function readReviews(req, knownIds) {
  const isKnown = typeof knownIds === "function" ? knownIds : (id) => knownIds.has(id);
  const raw = parseCookies(req.headers.cookie)[NAME];
  if (!raw) return {};
  const [payload, mac] = raw.split(".");
  if (!payload || !mac) return {};
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return {};
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
  const out = {};
  for (const [id, row] of Object.entries(data || {})) {
    if (!isKnown(id) || !row || !DECISIONS.has(row.decision)) continue;
    out[id] = { at: String(row.at).slice(0, 40), by: String(row.by).slice(0, 60), decision: row.decision };
  }
  return out;
}

export function writeReviews(req, res, reviews) {
  // Keep the cookie well under 4 KB: only the most recent reviews are kept.
  const kept = Object.fromEntries(
    Object.entries(reviews)
      .sort((a, b) => String(b[1].at).localeCompare(String(a[1].at)))
      .slice(0, MAX_ROWS),
  );
  const payload = Buffer.from(JSON.stringify(kept)).toString("base64url");
  const secure = String(req.headers["x-forwarded-proto"] || "").startsWith("https") ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${NAME}=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}${secure}`,
  );
}

export function reviewRow(clearsDraftBar, by = "Demo reviewer", at = new Date().toISOString()) {
  return { at, by, decision: clearsDraftBar ? "confirm-record" : "keep-in-training" };
}
