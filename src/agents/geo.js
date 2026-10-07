/**
 * GEO Publisher. Writes a public page an answer engine can check:
 * sourced facts, short quotations, and citations. No visibility promise.
 * The words "hire-ready" appear only after a person confirms a draft
 * that already cleared the evidence bar.
 */

function reviewSentence(assessment, confirmation) {
  if (confirmation?.decision === "confirm-record" && assessment.clearsDraftBar) {
    return `Review status: a demo reviewer confirmed this draft at ${confirmation.at}. It may be called hire-ready only as a supplement to time on a job.`;
  }
  if (confirmation?.decision === "keep-in-training") {
    return "Review status: a demo reviewer looked at this draft and kept it in training. It is not called hire-ready.";
  }
  return "Review status: draft. A person has not confirmed it, so it is not called hire-ready.";
}

export function publish(apprentice, assessment, pageUrl, confirmation = null) {
  const log = [];
  log.push({
    phase: "input",
    text: `Input: assessor draft for ${apprentice.name}. Coach notes stay off the public page. Review: ${confirmation ? confirmation.decision : "none yet"}.`,
  });

  const safety = assessment.competencies.find((row) => row.id === "safety");
  const safetyQuest = safety?.quests[0];
  const strongest = assessment.competencies
    .filter((row) => row.quests.length)
    .sort((a, b) => b.score - a.score)[0];
  const leadQuote = strongest?.quests[0];

  const quotations = [];
  if (leadQuote) {
    quotations.push({
      questId: leadQuote.id,
      text: leadQuote.evidence,
      label: strongest.label,
    });
  }
  if (safetyQuest && safetyQuest.id !== leadQuote?.id) {
    quotations.push({
      questId: safetyQuest.id,
      text: safetyQuest.evidence,
      label: safety.label,
    });
  }

  const citations = assessment.competencies
    .filter((row) => row.quests.length)
    .map((row) => ({
      competency: row.label,
      score: row.score,
      questIds: row.quests.map((quest) => quest.id),
      measured: "Immediately after the scenario",
      source: "QuestSignal demo fixture",
    }));

  const facts = [
    `${apprentice.name} is a ${apprentice.specialty.toLowerCase()} apprentice in ${apprentice.city}, California.`,
    `Draft signal score is ${assessment.signalScore} out of 100, from quest scores taken immediately after each scenario.`,
    `Game XP on the fixture card is ${apprentice.xp.toLocaleString("en-US")}. The signal leaves XP out. The card instead records fit, confidence, a mentor, and task variety.`,
    safetyQuest
      ? `Safety scenario: ${assessment.safetyGate}, ${assessment.safetyScore}/100. Quotation from ${safetyQuest.id}: “${safetyQuest.evidence}”`
      : `Safety scenario: ${assessment.safetyGate}, ${assessment.safetyScore}/100.`,
    reviewSentence(assessment, confirmation),
    "This record supplements time on a job. It names the task, the quotation, the issuer (QuestSignal demo desk), and a verification path on this page.",
    `Fit: ${assessment.persistence.fit}`,
    `Confidence, in their words: “${assessment.persistence.selfEfficacy}” Source: ${assessment.persistence.selfEfficacySource}.`,
    assessment.persistence.mentorConnected
      ? `Mentor on the fixture card: ${assessment.persistence.mentor}.`
      : "Mentor: none on this fixture card.",
    `Task variety on file: ${assessment.persistence.taskVariety.join(", ")}.`,
    "Source: QuestSignal demo fixture. The TradesQuest host publishes auth and CRM routes, not quests, XP, or apprentices.",
  ];

  const confirmedRecord = confirmation?.decision === "confirm-record" && assessment.clearsDraftBar;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    dateModified: "2026-10-07",
    description: facts[0],
    mainEntity: {
      "@type": "Person",
      name: apprentice.name,
      jobTitle: `${apprentice.specialty} apprentice`,
      address: {
        "@type": "PostalAddress",
        addressLocality: apprentice.city,
        addressRegion: "CA",
        addressCountry: "US",
      },
      knowsAbout: assessment.competencies
        .filter((row) => row.score >= 75 && row.quests.length)
        .map((row) => row.label),
      description: facts.slice(0, 5).join(" "),
      identifier: `questsignal:${apprentice.id}`,
    },
  };

  const quoteLines = quotations.map(
    (quote) => `- “${quote.text}” — ${quote.label}, quest ${quote.questId}`,
  );
  const citationLines = citations.map(
    (row) =>
      `- ${row.competency}: ${row.score}/100; evidence ${row.questIds.join(", ")}; ${row.measured}; ${row.source}`,
  );

  const llmsTxt = [
    `# ${apprentice.name} — ${apprentice.specialty} apprentice`,
    "",
    "> QuestSignal public profile. Demo fixture, not a live TradesQuest player.",
    "> A person confirms a draft before it is called hire-ready. This page does not promise that an answer engine will cite it.",
    "",
    "## Facts",
    ...facts.map((fact) => `- ${fact}`),
    "",
    "## Quotations",
    ...quoteLines,
    "",
    "## Citations",
    ...citationLines,
    "",
    "## Scope",
    "- The record supplements time on a job.",
    "- Issuer: QuestSignal demo desk.",
    `- Verification: ${pageUrl}#evidence`,
    confirmedRecord
      ? "- A demo reviewer confirmed this draft. Hire-ready here means that confirmation plus the evidence bar. It still supplements site time."
      : "- This draft is not called hire-ready.",
    `- Profile URL: ${pageUrl}`,
    "",
  ].join("\n");

  log.push({
    phase: "work",
    text: `Wrote ${facts.length} sourced facts, ${quotations.length} quotations, and ${citations.length} citations. No claim that an answer engine will cite the page.`,
  });
  log.push({
    phase: "output",
    text: `Public path /p/${apprentice.id}. Hire-ready wording: ${confirmedRecord ? "yes, after reviewer confirmation" : "no"}.`,
  });

  return {
    slug: apprentice.id,
    path: `/p/${apprentice.id}`,
    llmsPath: `/p/${apprentice.id}/llms.txt`,
    facts,
    quotations,
    citations,
    jsonLd,
    llmsTxt,
    confirmedRecord,
    log,
    input: {
      apprenticeId: apprentice.id,
      signalScore: assessment.signalScore,
      clearsDraftBar: assessment.clearsDraftBar,
      confirmation: confirmation?.decision ?? null,
    },
    output: {
      path: `/p/${apprentice.id}`,
      llmsPath: `/p/${apprentice.id}/llms.txt`,
      factCount: facts.length,
      quotationCount: quotations.length,
      jsonLdType: "ProfilePage",
      hireReadyWording: confirmedRecord,
    },
  };
}
