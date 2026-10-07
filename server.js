import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTradesQuestClient, PROBE } from "./src/tradesquest/client.js";
import { apprentices, employers, FIXTURE_LABEL } from "./src/data/fixture.js";
import {
  assessmentsById,
  runDesk,
  buildEmployerBoard,
  buildShortlist,
  profilePacket,
  publicPacket,
} from "./src/agents/run.js";
import { confirmDraft, getConfirmation } from "./src/review/store.js";
import {
  renderHome,
  renderDesk,
  renderProfile,
  renderShortlist,
  renderEmployer,
  renderPublic,
  renderNotFound,
} from "./src/http/render.js";

const PORT = Number(process.env.PORT) || 4173;
const HOST = "0.0.0.0";
const root = path.dirname(fileURLToPath(import.meta.url));
const client = createTradesQuestClient({ fixture: { apprentices, employers } });

function originOf(req) {
  const host = req.headers.host || `127.0.0.1:${PORT}`;
  return `http://${host}`;
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

const server = http.createServer(async (req, res) => {
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
    const confirm = pathname.match(/^\/desk\/([a-z0-9-]+)\/confirm$/);
    const profile = pathname.match(/^\/profiles\/([a-z0-9-]+)$/);
    const employer = pathname.match(/^\/employers\/([a-z0-9-]+)$/);
    const pub = pathname.match(/^\/p\/([a-z0-9-]+)$/);
    const pubLlms = pathname.match(/^\/p\/([a-z0-9-]+)\/llms\.txt$/);
    const apiDesk = pathname.match(/^\/api\/desk\/([a-z0-9-]+)$/);

    if (req.method === "POST" && confirm) {
      const packet = profilePacket(confirm[1]);
      if (!packet) {
        send(res, 404, "Unknown apprentice", "text/plain; charset=utf-8");
        return;
      }
      confirmDraft(confirm[1], packet.assessment.clearsDraftBar);
      redirect(res, `/profiles/${confirm[1]}`);
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
      send(res, 200, renderHome({ health: report, cards }), "text/html; charset=utf-8");
      return;
    }

    if (pathname === "/employers") {
      send(
        res,
        200,
        renderShortlist({ health: report, boards: buildShortlist() }),
        "text/html; charset=utf-8",
      );
      return;
    }

    if (desk) {
      const packet = await runDesk(
        desk[1],
        client,
        `${originOf(req)}/p/${desk[1]}`,
        getConfirmation(desk[1]),
      );
      if (!packet) {
        send(res, 404, renderNotFound(report), "text/html; charset=utf-8");
        return;
      }
      send(res, 200, renderDesk(packet), "text/html; charset=utf-8");
      return;
    }

    if (apiDesk) {
      const packet = await runDesk(
        apiDesk[1],
        client,
        `${originOf(req)}/p/${apiDesk[1]}`,
        getConfirmation(apiDesk[1]),
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
      const packet = profilePacket(profile[1], getConfirmation(profile[1]));
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
        }),
        "text/html; charset=utf-8",
      );
      return;
    }

    if (pubLlms) {
      const packet = publicPacket(
        pubLlms[1],
        `${originOf(req)}/p/${pubLlms[1]}`,
        getConfirmation(pubLlms[1]),
      );
      if (!packet) {
        send(res, 404, "Unknown apprentice\n", "text/plain; charset=utf-8");
        return;
      }
      send(res, 200, packet.geo.llmsTxt, "text/plain; charset=utf-8");
      return;
    }

    if (pub) {
      const packet = publicPacket(pub[1], `${originOf(req)}/p/${pub[1]}`, getConfirmation(pub[1]));
      if (!packet) {
        send(res, 404, renderNotFound(report), "text/html; charset=utf-8");
        return;
      }
      send(res, 200, renderPublic(packet, originOf(req), report), "text/html; charset=utf-8");
      return;
    }

    send(res, 404, renderNotFound(report), "text/html; charset=utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    send(res, 500, message, "text/plain; charset=utf-8");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`QuestSignal listening on http://127.0.0.1:${PORT}`);
});
