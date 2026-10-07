import { readFile } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
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
} from "../agents/run.js";
import {
  allConfirmations,
  clearConfirmation,
  confirmDraft,
  getConfirmation,
  storeKind,
} from "../review/store.js";
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

function originOf(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "127.0.0.1:4173";
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  return `${proto}://${host}`;
}

/** Set REVIEWER_PASSCODE to require it (plus a reviewer name) before a review changes. */
function reviewerGated() {
  return Boolean(process.env.REVIEWER_PASSCODE);
}

function passcodeMatches(given) {
  const expected = Buffer.from(process.env.REVIEWER_PASSCODE || "");
  const actual = Buffer.from(String(given || ""));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readForm(req) {
  if (req.body !== undefined) {
    if (typeof req.body === "string") return new URLSearchParams(req.body);
    if (Buffer.isBuffer(req.body)) return new URLSearchParams(req.body.toString("utf8"));
    if (req.body && typeof req.body === "object") return new URLSearchParams(req.body);
  }
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) break;
  }
  return new URLSearchParams(raw);
}

function send(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

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

  try {
    if (req.method === "GET" && pathname === "/styles.css") {
      const css = await readFile(path.join(root, "public", "styles.css"));
      send(res, 200, css, "text/css; charset=utf-8");
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
            reviewStore: storeKind(),
            reviewerGated: reviewerGated(),
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

    if (req.method === "POST" && review) {
      const [, id, action] = review;
      const packet = profilePacket(id);
      if (!packet) {
        send(res, 404, "Unknown apprentice", "text/plain; charset=utf-8");
        return;
      }
      const form = await readForm(req);
      const reviewer = String(form.get("reviewer") || "").trim().slice(0, 60);
      if (reviewerGated() && (!passcodeMatches(form.get("passcode")) || !reviewer)) {
        const deskPacket = await runDesk(id, client, `${originOf(req)}/p/${id}`, await getConfirmation(id));
        send(
          res,
          403,
          renderDesk(deskPacket, { gated: true, error: "That reviewer passcode did not match. Nothing was changed." }),
          "text/html; charset=utf-8",
        );
        return;
      }
      if (action === "reset") {
        await clearConfirmation(id);
        redirect(res, `/desk/${id}`);
        return;
      }
      await confirmDraft(id, packet.assessment.clearsDraftBar, reviewer || "Demo reviewer");
      redirect(res, `/profiles/${id}`);
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
        renderHome({ health: report, cards, confirmations: await allConfirmations() }),
        "text/html; charset=utf-8",
      );
      return;
    }

    if (pathname === "/employers") {
      send(
        res,
        200,
        renderShortlist({ health: report, boards: buildShortlist(), confirmations: await allConfirmations() }),
        "text/html; charset=utf-8",
      );
      return;
    }

    if (desk) {
      const packet = await runDesk(
        desk[1],
        client,
        `${originOf(req)}/p/${desk[1]}`,
        await getConfirmation(desk[1]),
      );
      if (!packet) {
        send(res, 404, renderNotFound(report), "text/html; charset=utf-8");
        return;
      }
      send(res, 200, renderDesk(packet, { gated: reviewerGated() }), "text/html; charset=utf-8");
      return;
    }

    if (apiDesk) {
      const packet = await runDesk(
        apiDesk[1],
        client,
        `${originOf(req)}/p/${apiDesk[1]}`,
        await getConfirmation(apiDesk[1]),
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
      );
      return;
    }

    if (profile) {
      const packet = profilePacket(profile[1], await getConfirmation(profile[1]));
      if (!packet) {
        send(res, 404, renderNotFound(report), "text/html; charset=utf-8");
        return;
      }
      send(res, 200, renderProfile(packet, report), "text/html; charset=utf-8");
      return;
    }

    if (employer) {
      const board = buildEmployerBoard(employer[1]);
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
          highlight: url.searchParams.get("highlight") || "",
          confirmations: await allConfirmations(),
        }),
        "text/html; charset=utf-8",
      );
      return;
    }

    if (pubLlms) {
      const packet = publicPacket(
        pubLlms[1],
        `${originOf(req)}/p/${pubLlms[1]}`,
        await getConfirmation(pubLlms[1]),
      );
      if (!packet) {
        send(res, 404, "Unknown apprentice\n", "text/plain; charset=utf-8");
        return;
      }
      send(res, 200, packet.geo.llmsTxt, "text/plain; charset=utf-8");
      return;
    }

    if (pub) {
      const packet = publicPacket(pub[1], `${originOf(req)}/p/${pub[1]}`, await getConfirmation(pub[1]));
      if (!packet) {
        send(res, 404, renderNotFound(report), "text/html; charset=utf-8");
        return;
      }
      send(res, 200, renderPublic(packet, originOf(req), report), "text/html; charset=utf-8");
      return;
    }

    send(res, 404, renderNotFound(report), "text/html; charset=utf-8");
  } catch (error) {
    console.error(error);
    send(res, 500, "Server error", "text/plain; charset=utf-8");
  }
}
