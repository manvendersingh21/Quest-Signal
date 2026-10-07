/** In-memory reviewer decisions for this demo process. Not a TradesQuest write. */

const decisions = new Map();

export function confirmDraft(apprenticeId, clearsDraftBar, at = new Date().toISOString()) {
  const row = {
    at,
    by: "Demo reviewer",
    decision: clearsDraftBar ? "confirm-record" : "keep-in-training",
  };
  decisions.set(apprenticeId, row);
  return row;
}

export function getConfirmation(apprenticeId) {
  return decisions.get(apprenticeId) ?? null;
}

export function clearConfirmations() {
  decisions.clear();
}
