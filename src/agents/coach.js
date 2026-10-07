/**
 * Coach. Assigns next quests and an interview script that quotes quest evidence.
 * Also names fit, confidence, mentor, and task variety. Those are the persistence fields.
 */
export function coach(apprentice, assessment, catalog) {
  const log = [];
  log.push({
    phase: "input",
    text: `Input: draft signal ${assessment.signalScore}, evidence bar ${assessment.clearsDraftBar ? "cleared" : "open"}, safety scenario ${assessment.safetyGate}, ${assessment.gaps.length} gap(s).`,
  });

  const nextQuests = assessment.gaps.slice(0, 3).map((gap) => {
    const quest = catalog[gap.id];
    return {
      id: quest.id,
      title: quest.title,
      hours: quest.hours,
      competency: gap.label,
      competencyId: gap.id,
      why: gap.reason,
    };
  });

  if (!assessment.persistence.mentorConnected) {
    log.push({
      phase: "work",
      text: "No mentor is named on the fixture card. Persistence surveys treat a trainer as part of staying.",
    });
  }

  const strengths = assessment.competencies
    .filter((row) => row.quests.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);

  const interviewPoints = strengths.map((row) => {
    const quest = row.quests[0];
    return `Quote ${row.label} at ${row.score}/100: “${quest.evidence}” Cite quest ${quest.id}, measured immediately after the scenario.`;
  });
  interviewPoints.push(
    `Say the trade fit in their words: “${assessment.persistence.fit}” Confidence on file: “${assessment.persistence.selfEfficacy}” (${assessment.persistence.selfEfficacySource}).`,
  );
  if (!assessment.persistence.mentorConnected) {
    interviewPoints.push("Name a mentor before this card goes to an employer. None is on file.");
  } else {
    interviewPoints.push(`Mentor on the fixture card: ${assessment.persistence.mentor}.`);
  }

  const plan = [];
  if (assessment.safetyGate === "fail") {
    plan.push("Week 1: repeat the safety scenario with a mentor watching. The last attempt failed.");
  }
  for (const [index, quest] of nextQuests.entries()) {
    plan.push(
      `Week ${plan.length + 1}: run “${quest.title}” (${quest.id}, ${quest.hours}h) to lift ${quest.competency}.`,
    );
    if (index === 2) break;
  }
  if (!plan.length) {
    plan.push("Week 1: repeat the lowest passing quest and keep the evidence quote.");
    plan.push("Week 2: rehearse two quest quotations with the mentor.");
    plan.push("Week 3: ask a reviewer to confirm the draft before it is called hire-ready.");
  } else if (assessment.clearsDraftBar) {
    plan.push("After the gap quest: a person confirms the draft before the record is called hire-ready.");
  }

  let headline;
  if (assessment.safetyGate === "fail") {
    headline = "Keep this in training. The safety scenario failed, and a person still has to review the draft.";
  } else if (!assessment.clearsDraftBar) {
    headline = `Keep practicing. The draft signal is ${assessment.signalScore}, under the evidence bar.`;
  } else if (assessment.gaps.length) {
    headline = `Draft clears the evidence bar. ${assessment.gaps.map((gap) => gap.label).join(", ")} would make the record stronger. A person confirms it before it is called hire-ready.`;
  } else {
    headline = "Draft clears the evidence bar. A person confirms it before it is called hire-ready.";
  }

  log.push({
    phase: "output",
    text: nextQuests.length
      ? `Next quests: ${nextQuests.map((quest) => quest.id).join(", ")}. Interview script quotes quest evidence.`
      : "No gap quest. The script quotes the strongest evidence.",
  });

  return {
    headline,
    nextQuests,
    interviewPoints,
    plan,
    log,
    input: {
      apprenticeId: apprentice.id,
      signalScore: assessment.signalScore,
      clearsDraftBar: assessment.clearsDraftBar,
      gaps: assessment.gaps.map((gap) => ({ id: gap.id, score: gap.score })),
      mentorConnected: assessment.persistence.mentorConnected,
    },
    output: {
      headline,
      nextQuestIds: nextQuests.map((quest) => quest.id),
      interviewPoints: interviewPoints.length,
    },
  };
}
