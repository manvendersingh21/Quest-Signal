import { esc, layout } from "./render.js";
import { rubrics } from "../data/fixture.js";
import { MIN_QUESTS, MAX_QUESTS } from "../records/intake.js";
import { VISITOR_LABEL } from "../records/store.js";

function fieldError(errors, key) {
  return errors[key] ? `<span class="field-error" id="err-${esc(key)}">${esc(errors[key])}</span>` : "";
}

function described(errors, key) {
  return errors[key] ? ` aria-invalid="true" aria-describedby="err-${esc(key)}"` : "";
}

function textField(values, errors, key, label, { max, hint = "", required = true, placeholder = "" } = {}) {
  return `<label class="field">${esc(label)}${required ? "" : " (optional)"}
        <input name="${esc(key)}" value="${esc(values[key])}" maxlength="${max}"${required ? " required" : ""}${placeholder ? ` placeholder="${esc(placeholder)}"` : ""}${described(errors, key)}>
        ${hint ? `<span class="meta">${esc(hint)}</span>` : ""}
        ${fieldError(errors, key)}
      </label>`;
}

function areaField(values, errors, key, label, { max, hint = "" } = {}) {
  return `<label class="field wide">${esc(label)}
        <textarea name="${esc(key)}" rows="3" maxlength="${max}" required${described(errors, key)}>${esc(values[key])}</textarea>
        ${hint ? `<span class="meta">${esc(hint)}</span>` : ""}
        ${fieldError(errors, key)}
      </label>`;
}

function tradeOptions(selected) {
  return Object.keys(rubrics)
    .map((trade) => `<option value="${esc(trade)}"${trade === selected ? " selected" : ""}>${esc(trade)}</option>`)
    .join("");
}

/** Competencies grouped by trade. The server checks the chosen one belongs to the trade. */
function competencyOptions(selected, trade) {
  const groups = Object.entries(rubrics)
    .map(
      ([name, rubric]) => `<optgroup label="${esc(name)}" data-trade="${esc(name)}">${rubric
        .map(
          (slot) =>
            `<option value="${esc(slot.id)}"${trade === name && slot.id === selected ? " selected" : ""}>${esc(slot.label)}</option>`,
        )
        .join("")}</optgroup>`,
    )
    .join("");
  return `<option value="">Choose a competency</option>${groups}`;
}

function questRow(row, index, values, errors) {
  const key = `quest_${index}`;
  const required = index < MIN_QUESTS ? " required" : "";
  return `<tr class="${errors[key] ? "row-error" : ""}">
          <td class="mono">${index + 1}</td>
          <td><select name="competency_${index}" aria-label="Competency, row ${index + 1}"${required}>${competencyOptions(row.competency, values.trade)}</select></td>
          <td><input name="title_${index}" value="${esc(row.title)}" maxlength="80" aria-label="Quest title, row ${index + 1}"${required}></td>
          <td><input name="score_${index}" value="${esc(row.score)}" inputmode="numeric" pattern="[0-9]{1,3}" maxlength="3" size="4" aria-label="Score 0 to 100, row ${index + 1}"${required}></td>
          <td><textarea name="evidence_${index}" rows="2" maxlength="300" aria-label="Evidence note, row ${index + 1}"${required}>${esc(row.evidence)}</textarea>
            ${errors[key] ? `<span class="field-error">${esc(errors[key])}</span>` : ""}</td>
        </tr>`;
}

const TRADE_FILTER = `<script>
  (() => {
    const trade = document.querySelector('select[name="trade"]');
    if (!trade) return;
    const sync = () => {
      document.querySelectorAll(".quest-rows select").forEach((select) => {
        select.querySelectorAll("optgroup").forEach((group) => {
          const on = !trade.value || group.dataset.trade === trade.value;
          group.hidden = !on;
          group.disabled = !on;
        });
        const chosen = select.selectedOptions[0];
        if (chosen && chosen.parentElement.disabled) select.value = "";
      });
    };
    trade.addEventListener("change", sync);
    sync();
  })();
</script>`;

export function renderIntake({ health, values, errors = {} }) {
  const count = Object.keys(errors).length;
  const summary = count
    ? `<div class="banner intake-errors" role="alert"><strong>${count === 1 ? "One thing to fix" : `${count} things to fix`} before this record can be saved.</strong>
        <ul>${Object.values(errors).map((text) => `<li>${esc(text)}</li>`).join("")}</ul></div>`
    : "";
  const rows = values.quests.map((row, index) => questRow(row, index, values, errors)).join("");
  const main = `
    <p class="kicker">Real use · new record</p>
    <h1>Add an apprentice</h1>
    <p class="lede">Enter a real apprentice’s quest evidence. The same four agents run on it: you get the desk, a skills profile, matches against the sample employers, and a public page with JSON-LD and llms.txt.</p>
    <section class="banner">
      <strong>Every page for this record says: “${esc(VISITOR_LABEL)}”</strong>
      <p>The record is saved once and cannot be edited here. Anyone with its link can open it. There is no public list of records, and its pages ask search engines not to index them. The Coach script for these records is rule-based; the evidence is not sent to a model.</p>
      <p>The evidence bar needs a safety score of 80 or more, at least four competencies with a quest, and a weighted signal of 75. Competencies with no quest count as zero, so a short record stays in training when a reviewer confirms it.</p>
    </section>
    ${summary}
    <form method="post" action="/new" class="panel intake" novalidate>
      <h2>Apprentice</h2>
      <div class="fields">
        ${textField(values, errors, "name", "Name", { max: 80 })}
        <label class="field">Trade
          <select name="trade" required${described(errors, "trade")}><option value="">Choose a trade</option>${tradeOptions(values.trade)}</select>
          ${fieldError(errors, "trade")}
        </label>
        ${textField(values, errors, "specialty", "Specialty", { max: 60, placeholder: "Inside wireman" })}
        ${textField(values, errors, "city", "City", { max: 60 })}
        ${textField(values, errors, "region", "Region", { max: 60, placeholder: "East Bay" })}
        ${textField(values, errors, "mentor", "Mentor name", { max: 80, required: false })}
      </div>
      <div class="fields">
        ${areaField(values, errors, "fit", "Fit, in their words", { max: 400, hint: "Why this trade, and which tasks they ask to repeat." })}
        ${areaField(values, errors, "selfEfficacy", "Confidence quote", { max: 200, hint: "One sentence they said about their own work." })}
        ${textField(values, errors, "taskVariety", "Task variety", { max: 300, hint: "Kinds of task they have done, separated by commas." })}
      </div>

      <h2>Quest evidence</h2>
      <p class="meta">${MIN_QUESTS} to ${MAX_QUESTS} rows. Leave unused rows blank. Describe what was observed; leave out claims about licenses, certification, injuries, wages, or hire-readiness. Quest IDs (V-001, V-002…) are assigned on save.</p>
      ${fieldError(errors, "quests")}
      <div class="table-wrap">
        <table class="quest-rows">
          <thead><tr><th>#</th><th>Competency</th><th>Quest title</th><th>Score</th><th>Evidence note (what was observed)</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <label class="field check">
        <input type="checkbox" name="permission" value="yes"${values.permission ? " checked" : ""} required${described(errors, "permission")}>
        I have this apprentice's permission to publish this record.
      </label>
      ${fieldError(errors, "permission")}
      <div class="actions">
        <button class="btn primary" type="submit">Run the agents on this record</button>
        <a class="btn ghost" href="/">Back to the desk</a>
      </div>
    </form>
    ${TRADE_FILTER}`;
  return layout({
    title: "Add an apprentice · QuestSignal",
    description: "Enter a real apprentice's quest evidence and run the four QuestSignal agents on it.",
    health,
    main,
    noindex: true,
  });
}
