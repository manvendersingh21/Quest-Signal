import { rubrics } from "../data/fixture.js";
import { newRecordId } from "./store.js";

/**
 * Intake for a real apprentice. Turns the /new form into a record shaped like a
 * fixture apprentice, or returns field errors. Everything is checked here, on the
 * server: lengths, score range, and that each competency belongs to the trade.
 */

export const MIN_QUESTS = 3;
export const MAX_QUESTS = 8;

// The same claim limits the desk holds itself to. Typed text is printed verbatim
// on the public page, so it cannot carry these claims either.
const CLAIMS = [
  [/hire-?ready/i, "hire-ready"],
  [/injur/i, "injuries"],
  [/licens/i, "a license"],
  [/certif/i, "certification"],
  [/degree-free/i, "degree-free"],
  [/guarantee/i, "a guarantee"],
  [/\bwages?\b|\bsalary\b|wage premium/i, "wages"],
  [/citation lift/i, "citation lift"],
];

const LIMITS = {
  name: [2, 80],
  specialty: [2, 60],
  city: [2, 60],
  region: [2, 60],
  fit: [10, 400],
  selfEfficacy: [3, 200],
  mentor: [0, 80],
  taskVariety: [2, 300],
};

const LABELS = {
  name: "Name",
  specialty: "Specialty",
  city: "City",
  region: "Region",
  fit: "Fit",
  selfEfficacy: "Confidence quote",
  mentor: "Mentor",
  taskVariety: "Task variety",
};

/** Collapses whitespace and line breaks so typed text cannot add lines to llms.txt. */
export function clean(value, max = 400) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max + 1);
}

function claimProblem(text) {
  const hit = CLAIMS.find(([pattern]) => pattern.test(text));
  return hit ? `Leave out claims about ${hit[1]}. Describe what was observed.` : null;
}

/** Reads the posted form into plain values the form can re-render. */
export function readIntake(form) {
  const values = {};
  for (const key of Object.keys(LIMITS)) values[key] = clean(form.get(key), LIMITS[key][1]);
  values.trade = clean(form.get("trade"), 40);
  values.permission = form.get("permission") === "yes";
  values.quests = [];
  for (let i = 0; i < MAX_QUESTS; i += 1) {
    values.quests.push({
      competency: clean(form.get(`competency_${i}`), 40),
      title: clean(form.get(`title_${i}`), 80),
      score: clean(form.get(`score_${i}`), 5),
      evidence: clean(form.get(`evidence_${i}`), 300),
    });
  }
  return values;
}

export function blankIntake() {
  return {
    name: "",
    trade: "",
    specialty: "",
    city: "",
    region: "",
    fit: "",
    selfEfficacy: "",
    mentor: "",
    taskVariety: "",
    permission: false,
    quests: Array.from({ length: MAX_QUESTS }, () => ({ competency: "", title: "", score: "", evidence: "" })),
  };
}

/**
 * @returns {{ errors: Record<string,string>, record: object|null }}
 * errors keys are field names (quest rows use `quest_<i>`); `form` is a general message.
 */
export function validateIntake(values, { now = new Date(), id = newRecordId() } = {}) {
  const errors = {};
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    const text = values[key];
    if (text.length < min) errors[key] = min <= 1 ? `${LABELS[key]} is required.` : `${LABELS[key]} needs at least ${min} characters.`;
    else if (text.length > max) errors[key] = `${LABELS[key]} is limited to ${max} characters.`;
    else if (text && claimProblem(text)) errors[key] = claimProblem(text);
  }

  const rubric = rubrics[values.trade];
  if (!rubric) errors.trade = "Choose a trade.";

  const taskVariety = values.taskVariety
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!errors.taskVariety && (taskVariety.length < 1 || taskVariety.length > 10 || taskVariety.some((item) => item.length > 40))) {
    errors.taskVariety = "List 1 to 10 kinds of task, separated by commas, each under 40 characters.";
  }

  const quests = [];
  values.quests.forEach((row, index) => {
    const filled = row.competency || row.title || row.score || row.evidence;
    if (!filled) return;
    const problems = [];
    if (!rubric || !rubric.some((slot) => slot.id === row.competency)) {
      problems.push(rubric ? `Choose a ${values.trade} competency.` : "Choose a trade, then a competency.");
    }
    if (row.title.length < 3 || row.title.length > 80) problems.push("Quest title needs 3 to 80 characters.");
    const score = /^\d{1,3}$/.test(row.score) ? Number(row.score) : NaN;
    if (!Number.isInteger(score) || score < 0 || score > 100) problems.push("Score is a whole number from 0 to 100.");
    if (row.evidence.length < 10 || row.evidence.length > 300) problems.push("Evidence note needs 10 to 300 characters.");
    const claim = claimProblem(`${row.title} ${row.evidence}`);
    if (claim) problems.push(claim);
    if (problems.length) {
      errors[`quest_${index}`] = problems.join(" ");
      return;
    }
    quests.push({
      id: `V-${String(quests.length + 1).padStart(3, "0")}`,
      title: row.title,
      competency: row.competency,
      score,
      evidence: row.evidence,
    });
  });
  const filledRows = values.quests.filter((row) => row.competency || row.title || row.score || row.evidence).length;
  if (filledRows < MIN_QUESTS || filledRows > MAX_QUESTS) {
    errors.quests = `Enter ${MIN_QUESTS} to ${MAX_QUESTS} quest evidence rows.`;
  }

  if (!values.permission) errors.permission = "Confirm you have this apprentice's permission to publish this record.";

  if (Object.keys(errors).length) return { errors, record: null };

  const mentor = values.mentor;
  const record = {
    id,
    name: values.name,
    trade: values.trade,
    specialty: values.specialty,
    city: values.city,
    region: values.region,
    xp: 0,
    level: 0,
    preferredPath: true,
    fit: values.fit,
    selfEfficacy: values.selfEfficacy,
    selfEfficacySource: "Quote entered with this record by the visitor",
    mentor: mentor || "None named on this record",
    mentorConnected: Boolean(mentor),
    taskVariety,
    sessionNote: `Entered ${now.toISOString().slice(0, 10)}. Not verified by TradesQuest.`,
    quests,
    source: "visitor",
    createdAt: now.toISOString(),
  };
  return { errors: {}, record };
}
