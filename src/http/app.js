import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTradesQuestClient, PROBE } from "../tradesquest/client.js";
import { apprentices, employers, FIXTURE_LABEL } from "../data/fixture.js";
import {
  assessmentsById,
  runDesk,
  buildEmployerBoard,
  buildShortlist,
  profilePacket,
  publicPacket,
  resolveApprentice,
  isVisitorRecord,
  withWrittenCoaching,
} from "../agents/run.js";
import { isRecordId, recordStoreKind, saveRecord } from "../records/store.js";
import { blankIntake, readIntake, validateIntake } from "../records/intake.js";
import { renderIntake } from "./render-intake.js";
import { writerConfig } from "../agents/writer.js";
import { getCached, setCached, storeKind } from "../agents/cache.js";
import { readReviews, reviewRow, writeReviews } from "../review/cookie.js";
import {
  renderHome,
  renderDesk,
  renderProfile,
  renderShortlist,
  renderEmployer,
  renderPublic,
  renderNotFound,
} from "./render.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const client = createTradesQuestClient({ fixture: { apprentices, employers } });
const modelCache = { get: getCached, set: setCached };
const knownIds = new Set(apprentices.map((row) => row.id));
// A review may be kept for a fixture apprentice or a well-formed visitor record id.
// The server still re-checks the evidence bar before it says hire-ready.
const mayHoldReview = (id) => knownIds.has(id) || isRecordId(id);
const FORM_LIMIT = 32 * 1024;
const DRAIN_LIMIT = 1024 * 1024;

class TooLarge extends Error {}

function originOf(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "127.0.0.1:4173";
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  return `${proto}://${host}`;
}

/** Reads a urlencoded form up to FORM_LIMIT bytes. A larger body throws TooLarge (sent as 413). */
async function readForm(req) {
  if (req.body !== undefined) {
    if (typeof req.body === "string" || Buffer.isBuffer(req.body)) {
      const text = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : req.body;
      if (Buffer.byteLength(text) > FORM_LIMIT) throw new TooLarge();
      return new URLSearchParams(text);
    }
    if (req.body && typeof req.body === "object") {
      if (Buffer.byteLength(JSON.stringify(req.body)) > FORM_LIMIT) throw new TooLarge();
      return new URLSearchParams(req.body);
    }
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // Past the limit, keep reading and discarding (up to a cap) so the client sees the 413.
    if (size > DRAIN_LIMIT) break;
    if (size <= FORM_LIMIT) chunks.push(chunk);
  }
  if (size > FORM_LIMIT) throw new TooLarge();
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#b8431f"/><path d="M9 21.5 15 9l3.2 7 2.3-3.5L25 21.5z" fill="#fffdf8"/></svg>`;

function send(res, status, body, type, cacheControl = "no-store", extraHeaders = {}) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": type,
    "Cache-Control": cacheControl,
    ...extraHeaders,
  });
  res.end(body);
}

// Visitor records stay out of search indexes, including the text/plain llms.txt.
const robotsFor = (apprentice) => (isVisitorRecord(apprentice) ? { "X-Robots-Tag": "noindex" } : {});

function redirect(res, location) {
  res.writeHead(303, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

async function health() {
  return client.health();
}

export async function handler(req, res) {
  const url = new URL(req.url || "/", originOf(req));
  const pathname = url.pathname;
  const reviews = readReviews(req, mayHoldReview);
  const getConfirmation = (id) => reviews[id] ?? null;

  try {
    if (req.method === "GET" && pathname === "/styles.css") {
      const css = await readFile(path.join(root, "public", "styles.css"));
      send(res, 200, css, "text/css; charset=utf-8", "public, max-age=300");
      return;
    }

    if (req.method === "GET" && (pathname === "/favicon.svg" || pathname === "/favicon.ico")) {
      send(res, 200, FAVICON, "image/svg+xml", "public, max-age=86400");
      return;
    }

    if (req.method === "GET" && pathname === "/robots.txt") {
      send(
        res,
        200,
        `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${originOf(req)}/sitemap.xml\n`,
        "text/plain; charset=utf-8",
        "public, max-age=3600",
      );
      return;
    }

    if (req.method === "GET" && pathname === "/sitemap.xml") {
      const paths = [
        "/",
        "/employers",
        ...employers.map((row) => `/employers/${row.id}`),
        ...apprentices.flatMap((row) => [`/p/${row.id}`, `/profiles/${row.id}`]),
      ];
      const urls = paths.map((p) => `  <url><loc>${originOf(req)}${p}</loc></url>`).join("\n");
      send(
        res,
        200,
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
        "application/xml; charset=utf-8",
        "public, max-age=3600",
      );
      return;
    }

    if (req.method === "GET" && pathname === "/api/status") {
      const report = await health();
      send(
        res,
        200,
        JSON.stringify(
          {
            product: "QuestSignal",
            tradesquest: report,
            evidence: "fixture",
            fixtureLabel: FIXTURE_LABEL,
            probe: PROBE,
            reviewState: "per-visitor signed cookie",
            visitorRecords: recordStoreKind(),
            modelCache: storeKind(),
            coachWriter: writerConfig()?.model ?? "rules",
            note: "No signup, sign-in, or early-access call is made.",
          },
          null,
          2,
        ),
        "application/json; charset=utf-8",
      );
      return;
    }

    if (req.method === "GET" && pathname === "/llms.txt") {
      const lines = [
        "# QuestSignal",
        "",
        "Commercial desk for a TradesQuest hackathon demo.",
        "",
        "## Live",
        "- Server-side GET https://stonebyte.bid/api/health",
        "- No CORS on that host. This demo does not call it from the browser.",
        "- Signup, sign-in, and early-access are not called.",
        "",
        "## Fixture",
        `- ${FIXTURE_LABEL}`,
        "- Quest evidence, XP, and employers are sample data.",
        "",
        "## Profiles",
        ...apprentices.map((row) => `- ${originOf(req)}/p/${row.id}`),
        "",
      ];
      send(res, 200, lines.join("\n"), "text/plain; charset=utf-8");
      return;
    }

    const desk = pathname.match(/^\/desk\/([a-z0-9-]+)$/);
    const review = pathname.match(/^\/desk\/([a-z0-9-]+)\/(confirm|reset)$/);
    const profile = pathname.match(/^\/profiles\/([a-z0-9-]+)$/);
    const employer = pathname.match(/^\/employers\/([a-z0-9-]+)$/);
    const pub = pathname.match(/^\/p\/([a-z0-9-]+)$/);
    const pubLlms = pathname.match(/^\/p\/([a-z0-9-]+)\/llms\.txt$/);
    const apiDesk = pathname.match(/^\/api\/desk\/([a-z0-9-]+)$/);
    const apiCoach = pathname.match(/^\/api\/coach\/([a-z0-9-]+)$/);

    if (pathname === "/new" && req.method === "POST") {
      const values = readIntake(await readForm(req));
      const { errors, record } = validateIntake(values);
      if (!record) {
        send(res, 400, renderIntake({ health: await health(), values, errors }), "text/html; charset=utf-8", "no-store", {
          "X-Robots-Tag": "noindex",
        });
        return;
      }
      await saveRecord(record);
      redirect(res, `/desk/${record.id}`);
      return;
    }

    if (pathname === "/new" && req.method === "GET") {
      send(res, 200, renderIntake({ health: await health(), values: blankIntake() }), "text/html; charset=utf-8", "no-store", {
        "X-Robots-Tag": "noindex",
      });
      return;
    }

    if (req.method === "POST" && review) {
      const [, id, action] = review;
      const packet = await profilePacket(id);
      if (!packet) {
        send(res, 404, "Unknown apprentice", "text/plain; charset=utf-8");
        return;
      }
      const form = await readForm(req);
      const reviewer = String(form.get("reviewer") || "").trim().slice(0, 60) || "Demo reviewer";
      const next = { ...reviews };
      if (action === "reset") {
        delete next[id];
        writeReviews(req, res, next);
        redirect(res, `/desk/${id}`);
        return;
      }
      next[id] = reviewRow(packet.assessment.clearsDraftBar, reviewer);
      writeReviews(req, res, next);
      redirect(res, `/profiles/${id}`);
      return;
    }

    if (req.method === "GET" && apiCoach) {
      const packet = await withWrittenCoaching(await profilePacket(apiCoach[1]), modelCache);
      if (!packet) {
        send(res, 404, JSON.stringify({ error: "Unknown apprentice" }), "application/json; charset=utf-8");
        return;
      }
      const { writer, headline, interviewPoints, log } = packet.coaching;
      send(
        res,
        200,
        JSON.stringify({ writer, headline, interviewPoints, log }, null, 2),
        "application/json; charset=utf-8",
      );
      return;
    }

    if (req.method !== "GET") {
      send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
      return;
    }

    const report = await health();

    if (pathname === "/") {
      const byId = assessmentsById();
      const cards = apprentices.map((apprentice) => ({
        apprentice,
        assessment: byId[apprentice.id],
      }));
      send(
        res,
        200,
        renderHome({ health: report, cards, confirmations: reviews }),
        "text/html; charset=utf-8",
      );
      return;
    }

    if (pathname === "/employers") {
      send(
        res,
        200,
        renderShortlist({ health: report, boards: buildShortlist(), confirmations: reviews }),
        "text/html; charset=utf-8",
      );
      return;
    }

    if (desk) {
      const packet = await withWrittenCoaching(
        await runDesk(
          desk[1],
          client,
          `${originOf(req)}/p/${desk[1]}`,
          getConfirmation(desk[1]),
        ),
        modelCache,
        { cachedOnly: true },
      );
      if (!packet) {
        send(res, 404, renderNotFound(report), "text/html; charset=utf-8");
        return;
      }
      send(res, 200, renderDesk(packet), "text/html; charset=utf-8", "no-store", robotsFor(packet.apprentice));
      return;
    }

    if (apiDesk) {
      const packet = await withWrittenCoaching(
        await runDesk(
          apiDesk[1],
          client,
          `${originOf(req)}/p/${apiDesk[1]}`,
          getConfirmation(apiDesk[1]),
        ),
        modelCache,
        { cachedOnly: true },
      );
      if (!packet) {
        send(res, 404, JSON.stringify({ error: "Unknown apprentice" }), "application/json; charset=utf-8");
        return;
      }
      send(
        res,
        200,
        JSON.stringify(
          {
            source: packet.source,
            sourceLabel: packet.sourceLabel,
            health: packet.health,
            confirmation: packet.confirmation,
            steps: packet.steps,
          },
          null,
          2,
        ),
        "application/json; charset=utf-8",
        "no-store",
        robotsFor(packet.apprentice),
      );
      return;
    }

    if (profile) {
      const packet = await withWrittenCoaching(
        await profilePacket(profile[1], getConfirmation(profile[1])),
        modelCache,
        { cachedOnly: true },
      );
      if (!packet) {
        send(res, 404, renderNotFound(report), "text/html; charset=utf-8");
        return;
      }
      send(res, 200, renderProfile(packet, report), "text/html; charset=utf-8", "no-store", robotsFor(packet.apprentice));
      return;
    }

    if (employer) {
      // A visitor record joins this one view when its link is in the URL; it is never listed elsewhere.
      const highlightId = url.searchParams.get("highlight") || "";
      const visitor = isRecordId(highlightId) ? await resolveApprentice(highlightId) : null;
      const board = buildEmployerBoard(employer[1], visitor ? [visitor] : []);
      if (!board) {
        send(res, 404, renderNotFound(report), "text/html; charset=utf-8");
        return;
      }
      send(
        res,
        200,
        renderEmployer({
          health: report,
          board,
          highlight: highlightId,
          confirmations: reviews,
        }),
        "text/html; charset=utf-8",
        "no-store",
        robotsFor(visitor),
      );
      return;
    }

    if (pubLlms) {
      const packet = await publicPacket(
        pubLlms[1],
        `${originOf(req)}/p/${pubLlms[1]}`,
        getConfirmation(pubLlms[1]),
      );
      if (!packet) {
        send(res, 404, "Unknown apprentice\n", "text/plain; charset=utf-8");
        return;
      }
      send(res, 200, packet.geo.llmsTxt, "text/plain; charset=utf-8", "no-store", robotsFor(packet.apprentice));
      return;
    }

    if (pub) {
      const packet = await publicPacket(pub[1], `${originOf(req)}/p/${pub[1]}`, getConfirmation(pub[1]));
      if (!packet) {
        send(res, 404, renderNotFound(report), "text/html; charset=utf-8");
        return;
      }
      send(res, 200, renderPublic(packet, originOf(req), report), "text/html; charset=utf-8", "no-store", robotsFor(packet.apprentice));
      return;
    }

    send(res, 404, renderNotFound(report), "text/html; charset=utf-8");
  } catch (error) {
    if (error instanceof TooLarge) {
      send(res, 413, `Form is larger than ${FORM_LIMIT / 1024} KB.`, "text/plain; charset=utf-8");
      return;
    }
    console.error(error);
    send(res, 500, "Server error", "text/plain; charset=utf-8");
  }
}
