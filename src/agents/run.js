import { assess } from "./assessor.js";
import { coach } from "./coach.js";
import { matchEmployers, rankCandidates, xpContrast } from "./matcher.js";
import { publish } from "./geo.js";
import { writeCoaching } from "./writer.js";
import {
  apprentices,
  employers,
  rubrics,
  questCatalog,
  apprenticeById,
  employerById,
  FIXTURE_LABEL,
} from "../data/fixture.js";
import { getRecord, isRecordId, VISITOR_LABEL } from "../records/store.js";

/** Fixture apprentice first, then a visitor record by its id. */
export async function resolveApprentice(apprenticeId) {
  const fixture = apprenticeById(apprenticeId);
  if (fixture) return fixture;
  if (!isRecordId(apprenticeId)) return null;
  const record = await getRecord(apprenticeId);
  return record && rubrics[record.trade] ? record : null;
}

export function sourceLabelOf(apprentice) {
  return apprentice?.source === "visitor" ? VISITOR_LABEL : FIXTURE_LABEL;
}

export function isVisitorRecord(apprentice) {
  return apprentice?.source === "visitor";
}

const AGENT_META = {
  assessor: {
    name: "Assessor",
    mandate: "Turn quest evidence into a draft signal. Leave XP on the game record. A person confirms it before anyone calls it hire-ready.",
  },
  coach: {
    name: "Coach",
    mandate: "Assign the next quests and a script that quotes quest evidence. Name fit, confidence, mentor, and task variety.",
  },
  matcher: {
    name: "Matcher",
    mandate: "Propose an employer order from the draft signal. A recruiter confirms it. XP stays out of the score.",
  },
  geo: {
    name: "GEO Publisher",
    mandate: "Publish sourced facts, quotations, and citations. Do not promise that an answer engine will cite the page.",
  },
};

export function assessmentsById() {
  return Object.fromEntries(
    apprentices.map((apprentice) => [apprentice.id, assess(apprentice, rubrics[apprentice.trade])]),
  );
}

export async function runDesk(apprenticeId, client, pageUrl, confirmation = null) {
  const loaded = client.getApprentice(apprenticeId);
  const apprentice = loaded.apprentice ?? (await resolveApprentice(apprenticeId));
  if (!apprentice) return null;
  const health = await client.health();
  const assessment = assess(apprentice, rubrics[apprentice.trade]);
  const coaching = coach(apprentice, assessment, questCatalog);
  const matching = matchEmployers(apprentice, assessment, client.listEmployers().employers);
  const geo = publish(apprentice, assessment, pageUrl, confirmation);

  const steps = [
    {
      id: "assessor",
      ...AGENT_META.assessor,
      input: assessment.input,
      output: assessment.output,
      log: assessment.log,
    },
    {
      id: "coach",
      ...AGENT_META.coach,
      input: coaching.input,
      output: coaching.output,
      log: coaching.log,
    },
    {
      id: "matcher",
      ...AGENT_META.matcher,
      input: matching.input,
      output: matching.output,
      log: matching.log,
    },
    {
      id: "geo",
      ...AGENT_META.geo,
      input: geo.input,
      output: geo.output,
      log: geo.log,
    },
  ];

  return {
    health,
    source: isVisitorRecord(apprentice) ? "visitor" : loaded.source,
    sourceLabel: sourceLabelOf(apprentice),
    apprentice,
    assessment,
    coaching,
    matching,
    geo,
    confirmation,
    steps,
  };
}

/**
 * Proposed order for one sample employer. `extra` adds a visitor record to this
 * one view (when its link is in the URL); it is never added to the stored board.
 */
export function buildEmployerBoard(employerId, extra = []) {
  const employer = employerById(employerId);
  if (!employer) return null;
  const byId = assessmentsById();
  for (const apprentice of extra) byId[apprentice.id] = assess(apprentice, rubrics[apprentice.trade]);
  const rows = rankCandidates(employer, [...apprentices, ...extra], byId).map((row) =>
    extra.some((apprentice) => apprentice.id === row.apprenticeId) ? { ...row, visitor: true } : row,
  );
  return {
    employer,
    rows,
    contrast: xpContrast(rows.filter((row) => !row.visitor)),
    sourceLabel: FIXTURE_LABEL,
  };
}

export function buildShortlist() {
  return employers.map((employer) => {
    const board = buildEmployerBoard(employer.id);
    return {
      employer,
      leaders: board.rows.filter((row) => row.tradeFit).slice(0, 3),
      contrast: board.contrast,
    };
  });
}

export async function profilePacket(apprenticeId, confirmation = null) {
  const apprentice = await resolveApprentice(apprenticeId);
  if (!apprentice) return null;
  const assessment = assess(apprentice, rubrics[apprentice.trade]);
  const coaching = coach(apprentice, assessment, questCatalog);
  const matching = matchEmployers(apprentice, assessment, employers);
  const hireReady = confirmation?.decision === "confirm-record" && assessment.clearsDraftBar;
  return {
    apprentice,
    assessment,
    coaching,
    matching,
    confirmation,
    hireReady,
    sourceLabel: sourceLabelOf(apprentice),
  };
}

export async function publicPacket(apprenticeId, pageUrl, confirmation = null) {
  const apprentice = await resolveApprentice(apprenticeId);
  if (!apprentice) return null;
  const assessment = assess(apprentice, rubrics[apprentice.trade]);
  const geo = publish(apprentice, assessment, pageUrl, confirmation);
  return { apprentice, assessment, geo, confirmation, sourceLabel: sourceLabelOf(apprentice) };
}

/**
 * Lets the Coach writer rewrite the script when a model key is set. Mutates nothing.
 * Visitor records are a real person's evidence, entered with permission to publish,
 * not to send to a model provider, so they always keep the rule-based script.
 */
export async function withWrittenCoaching(packet, cache, { cachedOnly = false } = {}) {
  if (!packet) return packet;
  if (isVisitorRecord(packet.apprentice)) {
    return {
      ...packet,
      coaching: {
        ...packet.coaching,
        writer: { source: "rules", note: "Visitor-entered records are not sent to a model." },
      },
    };
  }
  const coaching = await writeCoaching(packet.apprentice, packet.assessment, packet.coaching, {
    cache,
    cachedOnly,
  });
  const steps = packet.steps?.map((step) =>
    step.id === "coach" ? { ...step, output: coaching.output, log: coaching.log } : step,
  );
  return { ...packet, coaching, ...(steps ? { steps } : {}) };
}
