/**
 * Matcher. Proposes an employer order and a candidate order.
 * A recruiter confirms the order. XP is shown beside the row and left out of the score.
 */

function competencyScore(assessment, id) {
  return assessment.competencies.find((row) => row.id === id)?.score ?? 0;
}

export function scoreEmployer(apprentice, assessment, employer) {
  const tradeFit =
    employer.type === "workforce_board" || employer.trades.includes(apprentice.trade);
  const base = {
    employerId: employer.id,
    name: employer.name,
    type: employer.type,
    city: employer.city,
    region: employer.region,
    openings: employer.openings,
    tradeFit,
  };

  if (!tradeFit) {
    return {
      ...base,
      score: 12,
      reasons: [
        `${apprentice.trade} is outside this desk (${employer.trades.join(", ")}).`,
      ],
    };
  }

  if (employer.type === "workforce_board") {
    const safety = competencyScore(assessment, "safety");
    let score = Math.round(0.55 * safety + 0.45 * assessment.signalScore);
    score = Math.min(score, 78);
    const reasons = [
      "Board desk places every trade.",
      `Blend of safety ${safety} and signal ${assessment.signalScore}, capped so a craft desk can outrank a general board.`,
    ];
    if (apprentice.city === employer.city) reasons.push(`Same city: ${apprentice.city}.`);
    if (!assessment.clearsDraftBar) {
      reasons.push("Draft does not clear the evidence bar. A person would keep this off a placement list.");
    }
    return { ...base, score, reasons };
  }

  let weighted = 0;
  const reasons = [];
  let missed = false;
  for (const requirement of employer.requirements) {
    const score = competencyScore(assessment, requirement.competency);
    weighted += score * requirement.weight;
    const label = assessment.competencies.find((row) => row.id === requirement.competency)?.label
      ?? requirement.competency;
    if (score < requirement.min) {
      missed = true;
      reasons.push(`${label} ${score} is under the ${requirement.min} minimum.`);
    } else {
      reasons.push(`${label} ${score} clears the ${requirement.min} minimum.`);
    }
  }

  let score = weighted;
  if (missed) score *= 0.9;
  if (!assessment.clearsDraftBar) {
    score *= 0.85;
    reasons.push("Training hold: the evidence bar is open, so this rank is a recommendation only.");
  }
  if (apprentice.city === employer.city) {
    reasons.push(`Same city: ${apprentice.city}.`);
  } else if (apprentice.region === employer.region) {
    score *= 0.94;
    reasons.push(`Same region: ${apprentice.region}.`);
  } else {
    score *= 0.86;
    reasons.push(`${apprentice.city} is outside ${employer.region}.`);
  }

  return {
    ...base,
    score: Math.max(1, Math.min(99, Math.round(score))),
    reasons,
  };
}

export function matchEmployers(apprentice, assessment, employers) {
  const log = [];
  log.push({
    phase: "input",
    text: `Input: ${apprentice.name} signal ${assessment.signalScore}, safety ${assessment.safetyGate}, ${employers.length} sample employers.`,
  });
  const ranked = employers
    .map((employer) => scoreEmployer(apprentice, assessment, employer))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const topCraft = ranked.find((row) => row.tradeFit && row.type !== "workforce_board");
  log.push({
    phase: "work",
    text: "Scored each desk from required competencies, city, and the evidence bar. XP stayed out of the formula. A recruiter confirms this order.",
  });
  log.push({
    phase: "output",
    text: topCraft
      ? `Top craft desk: ${topCraft.name} at ${topCraft.score}.`
      : "No craft desk matched this trade.",
  });
  return {
    rankedEmployers: ranked,
    topCraft,
    log,
    input: {
      apprenticeId: apprentice.id,
      signalScore: assessment.signalScore,
      clearsDraftBar: assessment.clearsDraftBar,
      employerIds: employers.map((employer) => employer.id),
    },
    output: {
      topCraft: topCraft ? { id: topCraft.employerId, score: topCraft.score } : null,
      ranking: ranked.map((row) => ({ id: row.employerId, score: row.score, tradeFit: row.tradeFit })),
    },
  };
}

export function rankCandidates(employer, apprentices, assessmentsById) {
  const rows = apprentices.map((apprentice) => {
    const assessment = assessmentsById[apprentice.id];
    const match = scoreEmployer(apprentice, assessment, employer);
    const proposed = Boolean(assessment.clearsDraftBar && match.tradeFit);
    return {
      apprenticeId: apprentice.id,
      name: apprentice.name,
      trade: apprentice.trade,
      city: apprentice.city,
      xp: apprentice.xp,
      signalScore: assessment.signalScore,
      clearsDraftBar: assessment.clearsDraftBar,
      safetyGate: assessment.safetyGate,
      matchScore: match.score,
      reasons: match.reasons,
      tradeFit: match.tradeFit,
      proposed,
    };
  });

  rows.sort((a, b) => {
    if (a.proposed !== b.proposed) return a.proposed ? -1 : 1;
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    if (b.signalScore !== a.signalScore) return b.signalScore - a.signalScore;
    return a.name.localeCompare(b.name);
  });

  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function xpContrast(rows) {
  const pool = rows.filter((row) => row.tradeFit);
  if (pool.length < 2) return null;
  const xpLeader = [...pool].sort((a, b) => b.xp - a.xp || a.name.localeCompare(b.name))[0];
  const deskLeader = pool.find((row) => row.proposed) ?? pool[0];
  if (!deskLeader || xpLeader.apprenticeId === deskLeader.apprenticeId) return null;
  return { xpLeader, deskLeader };
}
