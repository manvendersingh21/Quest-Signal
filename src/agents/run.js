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
  if (!loaded.apprentice) return null;
  const health = await client.health();
  const apprentice = loaded.apprentice;
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
    source: loaded.source,
    sourceLabel: FIXTURE_LABEL,
    apprentice,
    assessment,
    coaching,
    matching,
    geo,
    confirmation,
    steps,
  };
}

export function buildEmployerBoard(employerId) {
  const employer = employerById(employerId);
  if (!employer) return null;
  const byId = assessmentsById();
  const rows = rankCandidates(employer, apprentices, byId);
  return {
    employer,
    rows,
    contrast: xpContrast(rows),
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

export function profilePacket(apprenticeId, confirmation = null) {
  const apprentice = apprenticeById(apprenticeId);
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
    sourceLabel: FIXTURE_LABEL,
  };
}

export function publicPacket(apprenticeId, pageUrl, confirmation = null) {
  const apprentice = apprenticeById(apprenticeId);
  if (!apprentice) return null;
  const assessment = assess(apprentice, rubrics[apprentice.trade]);
  const geo = publish(apprentice, assessment, pageUrl, confirmation);
  return { apprentice, assessment, geo, confirmation, sourceLabel: FIXTURE_LABEL };
}

/** Lets the Coach writer rewrite the script when a model key is set. Mutates nothing. */
export async function withWrittenCoaching(packet, cache) {
  if (!packet) return packet;
  const coaching = await writeCoaching(packet.apprentice, packet.assessment, packet.coaching, { cache });
  const steps = packet.steps?.map((step) =>
    step.id === "coach" ? { ...step, output: coaching.output, log: coaching.log } : step,
  );
  return { ...packet, coaching, ...(steps ? { steps } : {}) };
}
