const DRAFT_BAR = 75;
const SAFETY_BAR = 80;
const MIN_EVIDENCE = 4;

/**
 * Assessor. Reads quest evidence into a draft skills signal.
 * XP stays on the game record. Nothing here is called hire-ready.
 * A person confirms that later.
 */
export function assess(apprentice, rubric) {
  const log = [];
  const source = apprentice.source === "visitor" ? "visitor" : "fixture";
  log.push({
    phase: "input",
    text: `Input: ${apprentice.quests.length} quest records for ${apprentice.name}, ${apprentice.specialty}, ${apprentice.city}. Source: ${source === "visitor" ? "entered by a visitor, not verified by TradesQuest" : "demo fixture"}.`,
  });
  log.push({
    phase: "work",
    text: `${Number(apprentice.xp || 0).toLocaleString("en-US")} XP stays on the game record. The signal uses quest scores taken immediately after each scenario.`,
  });

  const competencies = rubric.map((slot) => {
    const quests = apprentice.quests.filter((quest) => quest.competency === slot.id);
    const score = quests.length
      ? Math.round(quests.reduce((sum, quest) => sum + quest.score, 0) / quests.length)
      : 0;
    return {
      id: slot.id,
      label: slot.label,
      weight: slot.weight,
      score,
      quests: quests.map((quest) => ({
        id: quest.id,
        title: quest.title,
        score: quest.score,
        evidence: quest.evidence,
      })),
    };
  });

  const signalScore = Math.round(
    competencies.reduce((sum, row) => sum + row.score * row.weight, 0),
  );
  const safety = competencies.find((row) => row.id === "safety");
  const safetyScore = safety ? safety.score : 0;
  const safetyGate = safetyScore >= SAFETY_BAR ? "pass" : "fail";
  const evidenced = competencies.filter((row) => row.quests.length > 0).length;
  const gaps = competencies
    .filter((row) => row.score < DRAFT_BAR)
    .map((row) => ({
      id: row.id,
      label: row.label,
      score: row.score,
      reason: row.quests.length
        ? `${row.score}/100 is under the ${DRAFT_BAR} draft bar`
        : "No quest evidence on file",
    }));
  const clearsDraftBar = safetyGate === "pass" && signalScore >= DRAFT_BAR && evidenced >= MIN_EVIDENCE;

  const persistence = {
    preferredPath: Boolean(apprentice.preferredPath),
    fit: apprentice.fit,
    selfEfficacy: apprentice.selfEfficacy,
    selfEfficacySource: apprentice.selfEfficacySource,
    mentor: apprentice.mentor,
    mentorConnected: Boolean(apprentice.mentorConnected),
    taskVariety: apprentice.taskVariety ?? [],
    sessionNote: apprentice.sessionNote,
  };

  log.push({
    phase: "work",
    text: `Safety scenario ${safetyGate} at ${safetyScore}/100. That is one drill, measured right after it. Competencies with a quest ID: ${evidenced}. Invented competencies: none.`,
  });
  log.push({
    phase: "work",
    text: `Persistence fields, separate from the score: fit, confidence (“${persistence.selfEfficacy}”), mentor ${persistence.mentorConnected ? "named" : "missing"}, ${persistence.taskVariety.length} kinds of task.`,
  });
  log.push({
    phase: "output",
    text: `Draft signal ${signalScore}/100. Evidence bar ${clearsDraftBar ? "cleared" : "not cleared"}. Awaiting a person before anyone calls this hire-ready.`,
  });

  const summary = clearsDraftBar
    ? `${apprentice.name} has a ${signalScore} draft signal from cited quests. A reviewer still has to confirm it.`
    : safetyGate === "fail"
      ? `${apprentice.name} has a failed safety scenario at ${safetyScore}/100. The draft stays in training until a person reviews it.`
      : `${apprentice.name} has a draft signal of ${signalScore}, under the ${DRAFT_BAR} bar. The draft stays in training until a person reviews it.`;

  return {
    apprenticeId: apprentice.id,
    name: apprentice.name,
    trade: apprentice.trade,
    city: apprentice.city,
    xp: apprentice.xp,
    signalScore,
    clearsDraftBar,
    safetyGate,
    safetyScore,
    competencies,
    gaps,
    persistence,
    summary,
    log,
    input: {
      source,
      apprenticeId: apprentice.id,
      xpLeftOut: apprentice.xp,
      quests: apprentice.quests.map((quest) => ({
        id: quest.id,
        competency: quest.competency,
        score: quest.score,
      })),
    },
    output: {
      signalScore,
      clearsDraftBar,
      safetyGate,
      xpLeftOut: apprentice.xp,
      gaps: gaps.map((gap) => gap.label),
      inventedCompetencies: [],
      review: "awaiting a person",
    },
  };
}
