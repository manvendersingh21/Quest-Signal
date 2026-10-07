/**
 * Typed client for the TradesQuest host at stonebyte.bid.
 *
 * Probe on 2026-10-07:
 * - GET /api/health returns JSON { status, timestamp, environment }. This client calls it.
 * - POST /api/early-access, POST /api/signup, and POST /api/signin exist.
 *   Empty bodies return 400 JSON. This client has no write methods, so the demo
 *   cannot create signups, accounts, or CRM leads.
 * - GET /api/crm/leads, /contacts, /stats, and /session return 401 JSON
 *   ("CRM session expired or required.").
 * - GET /api/quests, /api/players, /api/apprentices, /openapi.json, /docs,
 *   and /api/docs return the marketing HTML shell, not an API.
 * - /llms.txt and /sitemap.xml describe the marketing site. They do not list quests.
 *
 * No CORS headers on that host, so this client is for the server, not the browser.
 * This demo calls GET /api/health only. It does not call signup, sign-in, or early-access.
 *
 * Quest evidence, XP, and employer openings come from the labeled fixture.
 */

export const TRADESQUEST_ORIGIN = "https://stonebyte.bid";

export const PROBE = {
  date: "2026-10-07",
  origin: TRADESQUEST_ORIGIN,
  liveRead: {
    method: "GET",
    path: "/api/health",
    shape: "{ status: string, timestamp: string, environment: string }",
  },
  htmlShellNotApi: [
    "/api/quests",
    "/api/players",
    "/api/apprentices",
    "/api/employers",
    "/openapi.json",
    "/docs",
    "/api/docs",
    "/swagger.json",
  ],
  sessionRequired: [
    "GET /api/crm/leads",
    "GET /api/crm/contacts",
    "GET /api/crm/stats",
    "GET /api/crm/session",
  ],
  writesDiscoveredNotCalled: [
    "POST /api/early-access { email, source } → { success } or { error }",
    "POST /api/signup { email, password, name, city, role } → JSON error field on failure",
    "POST /api/signin { email, password } → JSON error field on failure",
    "POST /api/crm/session { password } → { expiresAt } when authorized",
  ],
};

/**
 * @typedef {Object} HealthReport
 * @property {boolean} live
 * @property {boolean} ok
 * @property {number} [status]
 * @property {{ status?: string, timestamp?: string, environment?: string }} [body]
 * @property {string} [error]
 * @property {number} [ms]
 * @property {string} url
 */

/**
 * @param {{ fetchImpl?: typeof fetch, fixture: { apprentices: unknown[], employers: unknown[] }, now?: () => number }} options
 */
export function createTradesQuestClient({ fetchImpl = fetch, fixture, now = Date.now }) {
  let healthCache = null;

  return {
    origin: TRADESQUEST_ORIGIN,
    probe: PROBE,

    /** @returns {Promise<HealthReport>} */
    async health() {
      if (healthCache && now() - healthCache.at < 15000) return healthCache.value;
      const url = `${TRADESQUEST_ORIGIN}/api/health`;
      const started = now();
      /** @type {HealthReport} */
      let value;
      try {
        const response = await fetchImpl(url, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(4000),
        });
        const text = await response.text();
        let body = null;
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
        const json = body && typeof body === "object" && !Array.isArray(body);
        value = {
          live: Boolean(response.ok && json && body.status),
          ok: response.ok,
          status: response.status,
          body: json ? body : undefined,
          error: json ? undefined : "Health response was not JSON.",
          ms: now() - started,
          url,
        };
      } catch (error) {
        value = {
          live: false,
          ok: false,
          error: error instanceof Error ? error.message : "Health check failed.",
          ms: now() - started,
          url,
        };
      }
      healthCache = { at: now(), value };
      return value;
    },

    listApprentices() {
      return {
        source: "fixture",
        label: "Demo fixture. The TradesQuest host has no public apprentice endpoint.",
        apprentices: fixture.apprentices,
      };
    },

    getApprentice(id) {
      const apprentice = fixture.apprentices.find((row) => row.id === id) ?? null;
      return {
        source: "fixture",
        label: "Demo fixture. The TradesQuest host has no public apprentice endpoint.",
        apprentice,
      };
    },

    listEmployers() {
      return {
        source: "fixture",
        label: "Demo fixture. The TradesQuest host has no public employer endpoint.",
        employers: fixture.employers,
      };
    },
  };
}
