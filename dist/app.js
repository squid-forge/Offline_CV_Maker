"use strict";

import { addTerm, agentDocument, applyDocument, cleanDraft, cleanAppearance, redactor, toExport, validateBlockReply, TOKEN, SECTIONS, GROUPS, ENTRY_FIELDS, CEFR_FIELDS, LEVELS, MAX_CUSTOM_SECTIONS } from "./privacy.mjs";

const STORAGE_KEY = "local-cv-maker-draft-v2";
const APP_THEME_KEY = "local-cv-maker-ui-theme";
const EXAMPLE = {
  layout: "technical",
  headline: "Junior technical assistant",
  about: "Example profile for an early-career applicant with experience documenting tests and building small prototypes.",
  work: [
    {
      title: "Technical intern",
      organisation: "Example Workshop",
      dates: "06/20XX – 08/20XX",
      description: "Recorded test results and wrote a checklist for repeatable setup.\nSummarised findings in a short handover document.",
    },
  ],
  education: [{
    title: "Diploma in applied technology",
    organisation: "Example College",
    dates: "09/20XX – 06/20XX",
    description: "Selected coursework in measurement, data analysis and technical communication.",
  }],
  projects: [
    {
      title: "Temperature logger",
      organisation: "Course project",
      description: "Built a simple prototype and compared sample readings across three conditions.",
    },
  ],
  skills: "Spreadsheet analysis, written test procedures and version control.",
  languages: [{ title: "English", listening: "B2", reading: "B2", production: "B1", interaction: "B1", writing: "B1" }],
};

const editor = document.querySelector("#editor-panel");
const preview = document.querySelector("#cv-preview");
const status = document.querySelector("#save-status");
const notice = document.querySelector("#editor-message");
const tabs = [...document.querySelectorAll("[data-tab]")];
const backupInput = document.querySelector("#backup-file");
const printButton = document.querySelector("#print-cv");
const appTheme = document.querySelector("#app-theme");
const systemTheme = matchMedia("(prefers-color-scheme: dark)");
const fileMenu = document.querySelector(".file-menu");
const aiDialog = document.querySelector("#block-ai");
const aiInstruction = document.querySelector("#block-ai-instruction");
const aiProposal = document.querySelector("#block-ai-proposal");
const aiStatus = document.querySelector("#block-ai-status");
const aiQueue = document.querySelector("#block-ai-queue");
const aiNext = document.querySelector("#block-ai-next");
const aiCancel = document.querySelector("#block-ai-cancel");
const aiApply = document.querySelector("#block-ai-apply");
const openSections = new Set(["about"]);
const openEntries = new WeakSet();
const entryRecords = new WeakMap();
let aiBlock = null;
let queuedBlock = null;
let nextBlock = null;
let aiFailure = "";
let activeTab = "blocks";
let reviewingProposal = false;
let exchange = { request: null, proposal: null };
let instruction = "";
let exchangeReady = false;
let exchangeBusy = false;
let exchangeGeneration = 0;
let saveTimer = null;
let draftRevision = 0;

function applyAppTheme() {
  document.documentElement.dataset.uiTheme = appTheme.value === "system"
    ? (systemTheme.matches ? "dark" : "light")
    : appTheme.value;
}

try {
  const saved = localStorage.getItem(APP_THEME_KEY);
  if ([...appTheme.options].some(option => option.value === saved)) appTheme.value = saved;
} catch { /* The theme still works for the current session. */ }
applyAppTheme();
systemTheme.addEventListener("change", applyAppTheme);
appTheme.addEventListener("change", () => {
  applyAppTheme();
  try { localStorage.setItem(APP_THEME_KEY, appTheme.value); }
  catch { /* The theme still works for the current session. */ }
});

document.addEventListener("click", event => {
  if (fileMenu.open && !fileMenu.contains(event.target)) fileMenu.open = false;
});
fileMenu.addEventListener("keydown", event => {
  if (event.key !== "Escape" || !fileMenu.open) return;
  fileMenu.open = false;
  fileMenu.querySelector("summary").focus();
});

function readDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && typeof saved === "object") return cleanDraft(saved);
  } catch {
    // A draft can still be edited and backed up if browser storage is unavailable.
  }
  return cleanDraft(EXAMPLE);
}

let draft = readDraft();

function saveDraft() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    status.textContent = "Saved in this browser";
  } catch {
    status.textContent = "Browser save unavailable";
  }
}

function changed() {
  reviewingProposal = false;
  renderPreview();
  syncBlockPanel();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 180);
}

function maskBody() {
  const safe = agentDocument(draft);
  for (const key of ["headline", "about", "motherTongue", "skills"]) draft[key] = safe[key];
  for (const group of [...Object.keys(GROUPS), "customSections"]) {
    draft[group].forEach((row, index) => Object.assign(row, safe[group][index]));
  }
}

function syncMaskedFields() {
  for (const control of editor.querySelectorAll("[data-field]:not([data-personal])")) {
    const { field, group } = control.dataset;
    control.value = fieldRecord(control.dataset)[field];
    if (group && field === "title") updateBlockTitle(control, group, control.value);
  }
}

function fieldRecord({ group, index, personal }, cv = draft) {
  if (group) return cv[group]?.[Number(index)];
  return personal ? cv.personal : cv;
}

function updateBlockTitle(control, group, value) {
  control.closest("details").querySelector("summary > span").textContent =
    value || (group === "customSections" ? "Custom section" : "New " + GROUPS[group][1]);
}

function escapeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function field(label, key, value, options = {}) {
  const { multiline = false, type = "text", placeholder = "", attributes = "", canMark = false } = options;
  const props = `data-field="${key}" ${attributes} maxlength="${multiline ? 4000 : 250}" placeholder="${escapeText(placeholder)}"`;
  const control = multiline
    ? `<textarea ${props} rows="4">${escapeText(value)}</textarea>`
    : `<input ${props} type="${type}" value="${escapeText(value)}">`;
  const labelled = `<label>${label}${control}</label>`;
  return canMark ? `<div class="markable">${labelled}<button class="text-button" type="button" data-action="mark-text">Mark selected text as private</button></div>` : labelled;
}

function personal() {
  const p = draft.personal;
  const personalOptions = { attributes: 'data-personal="true"' };
  return `<div class="fields">
    <p class="privacy-hint">Personal details are kept in this browser and restored during full PDF export. Matching text elsewhere becomes a placeholder.</p>
    <div class="photo-editor">
      <div class="photo-tile${p.photo ? "" : " placeholder"}" aria-hidden="true">${p.photo ? `<img src="${p.photo}" alt="">` : ""}</div>
      <div><p class="photo-caption">Profile photo <span class="field-hint">(optional)</span></p>
        <div class="photo-actions">
          <button class="text-button" type="button" data-action="choose-photo">${p.photo ? "Replace photo" : "Add photo"}</button>
          ${p.photo ? '<button class="text-button" type="button" data-action="remove-photo">Remove</button>' : ""}
          <input id="photo-file" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Profile photo file" hidden>
        </div>
      </div>
    </div>
    ${field("Full name", "name", p.name, personalOptions)}
    <div class="field-pair">${field("Email", "email", p.email, { ...personalOptions, type: "email" })}${field("Phone", "phone", p.phone, { ...personalOptions, type: "tel" })}</div>
    ${field("Street address", "address", p.address, personalOptions)}
    <div class="field-pair">${field("Postal code", "postalCode", p.postalCode, personalOptions)}${field("City and country", "city", p.city, personalOptions)}</div>
    ${field("Website or portfolio", "website", p.website, personalOptions)}
    <div class="field-pair">${field("Date of birth (optional)", "birthDate", p.birthDate, personalOptions)}${field("Nationality (optional)", "nationality", p.nationality, personalOptions)}</div>
    <section class="private-terms">
      <h3>Private words and phrases</h3>
      <p class="privacy-hint">Mark names, places or other details that you also use in descriptions.</p>
      <div class="term-input">
        <label>Private word or phrase<input id="private-term" type="text" maxlength="250"></label>
        <button class="button ghost" type="button" data-action="add-term">Add term</button>
      </div>
      ${draft.terms.length ? `<ul>${draft.terms.map((term, index) => `<li><span>${escapeText(term)}</span><button class="text-button" type="button" data-action="remove-term" data-index="${index}" aria-label="Stop hiding ${escapeText(term)}">Remove</button></li>`).join("")}</ul>` : ""}
    </section>
    <button class="text-button private-backup" type="button" data-action="private-backup">Save full backup with personal information</button>
  </div>`;
}

const STYLE_SELECTS = {
  font: ["Typeface", { sans: "Sans serif", serif: "Serif", humanist: "Humanist sans" }],
  density: ["Density", { balanced: "Balanced", compact: "Compact", spacious: "Spacious" }],
  photoPosition: ["Photo placement", { right: "Right", left: "Left" }],
  headerAlignment: ["Header alignment", { left: "Left", center: "Centered" }],
  rules: ["Section dividers", { thin: "Thin", none: "None", heavy: "Heavy" }],
};

const STYLE_NUMBERS = {
  fontSize: ["Type size (pt)", 9, 13, 0.25],
  spacing: ["Line spacing multiplier", 0.7, 1.5, 0.05],
  margin: ["Page margin (mm)", 10, 22, 1],
};

const THEMES = {
  classic: ["Classic", { accent: "#1d5370", textColor: "#243644", font: "sans", rules: "thin", density: "balanced", headerAlignment: "left" }],
  editorial: ["Editorial", { accent: "#773c46", textColor: "#34272b", font: "serif", rules: "thin", density: "spacious", headerAlignment: "center" }],
  modern: ["Modern", { accent: "#18655c", textColor: "#253831", font: "humanist", rules: "heavy", density: "balanced", headerAlignment: "left" }],
  minimal: ["Minimal", { accent: "#303643", textColor: "#303643", font: "sans", rules: "none", density: "compact", headerAlignment: "left" }],
};

const SECTION_LABELS = {
  headline: "Professional headline", about: "About me", skills: "Digital and technical skills",
  ...Object.fromEntries(Object.entries(GROUPS).map(([key, [label]]) => [key, label])),
};

function sectionOrder(cv) {
  const order = cv.appearance.sectionOrder.length ? [...cv.appearance.sectionOrder] :
    [...(cv.layout === "technical" ? SECTIONS : ["about", "work", "education", "projects", "skills", "languages"])];
  if (!order.includes("headline")) order.unshift("headline");
  for (const { id } of cv.customSections ?? []) if (!order.includes(id)) order.push(id);
  return order;
}

function matchesTheme(style) {
  return Object.entries(style).every(([key, value]) => draft.appearance[key] === value);
}

function stylePanel(customizing) {
  const settings = draft.appearance;
  return `<div class="fields">
    <div class="theme-grid" role="group" aria-label="CV themes">${Object.entries(THEMES).map(([key, [label, style]]) =>
      `<button class="theme-card" type="button" data-action="theme" data-key="${key}" aria-pressed="${matchesTheme(style)}">${label}</button>`).join("")}</div>
    <details class="theme-options" ${customizing ? "open" : ""}>
      <summary>Customize theme</summary>
      <div class="field-pair">
      <label>Accent color<input type="color" data-style="accent" value="${settings.accent}"></label>
      <label>Text color<input type="color" data-style="textColor" value="${settings.textColor}"></label>
      ${Object.entries(STYLE_SELECTS).map(([key, [label, choices]]) =>
        `<label>${label}<select data-style="${key}">${Object.entries(choices).map(([value, title]) =>
          `<option value="${value}"${value === settings[key] ? " selected" : ""}>${title}</option>`).join("")}</select></label>`,
      ).join("")}
      ${Object.entries(STYLE_NUMBERS).map(([key, [label, min, max, step]]) =>
        `<label>${label}<input type="number" data-style="${key}" value="${settings[key]}" min="${min}" max="${max}" step="${step}"></label>`,
      ).join("")}
      </div>
    </details>
  </div>`;
}

function agentPanel() {
  return `<div class="fields">
    <p class="privacy-hint">Send the redacted CV to your agent for editing or styling.</p>
    <label>Editing request<textarea id="agent-instruction" rows="4" maxlength="4000" placeholder="Tighten the bullet points and style the CV for one page.">${escapeText(instruction)}</textarea></label>
    <details class="agent-request-preview"><summary>Review the request the agent will see</summary><p id="agent-instruction-preview" class="cv-text"></p></details>
    <div class="agent-actions">
      <button class="button primary" type="button" data-action="queue-request">Queue MCP request</button>
    </div>
    <p id="agent-status" class="privacy-hint" role="status"></p>
    <p id="proposal-note" class="privacy-hint" hidden></p>
    <div class="agent-actions" id="proposal-actions" hidden>
      <button class="button ghost" type="button" data-action="preview-proposal">Preview proposal</button>
      <button class="button primary" type="button" data-action="apply-proposal">Apply proposal</button>
    </div>
    <button class="button ghost" type="button" data-action="review-block" hidden>Open block request</button>
    <button class="text-button private-backup" type="button" data-action="clear-request" id="clear-request" hidden>Clear live request</button>
  </div>`;
}

function moveControls(scope, attributes, label, index, count) {
  return `<div class="move-controls">${["up", "down"].map((direction, offset) => {
    const action = scope === "section" ? "section-" + direction : direction;
    const text = `Move ${scope} ${direction}`;
    return `<button class="move-button" type="button" data-action="${action}" ${attributes}
      aria-label="${text}" aria-describedby="${label}" title="${text}" ${index === (offset ? count - 1 : 0) ? "disabled" : ""}>${offset ? "↓" : "↑"}</button>`;
  }).join("")}</div>`;
}

function listEditor(group) {
  const [, singular, organisationLabel] = GROUPS[group];
  const entries = draft[group];
  return `${entries.map((row, index) => {
      const attributes = `data-group="${group}" data-index="${index}"`;
      const label = `entry-${group}-${index}`;
      const inputs = group === "languages" ? `<div class="levels">${Object.entries(CEFR_FIELDS).map(([key, label]) =>
        `<label>${label}<select data-field="${key}" ${attributes}>
          <option value="">—</option>${LEVELS.map(level => `<option${row[key] === level ? " selected" : ""}>${level}</option>`).join("")}
        </select></label>`,
      ).join("")}</div>` : `
        ${field(organisationLabel, "organisation", row.organisation, { attributes })}
        ${field("Dates", "dates", row.dates, { attributes, placeholder: "MM/YYYY – MM/YYYY" })}
        ${field("Highlights · one per line", "description", row.description, { attributes, multiline: true, canMark: true })}
      `;
      return `<div class="entry-row">
      <details class="edit-entry" ${attributes} ${openEntries.has(row) ? "open" : ""}>
        <summary id="${label}"><span>${escapeText(row.title || ("New " + singular))}</span></summary>
        <div class="fields">${field(group === "languages" ? "Language" : "Title", "title", row.title, { attributes })}${inputs}
          <div class="entry-actions">
            <button class="button ghost" type="button" data-action="ask-ai" ${attributes}>Ask AI</button>
            <button class="text-button" type="button" data-action="remove" ${attributes}>Remove</button>
          </div>
        </div>
      </details>
      ${moveControls("entry", attributes, label, index, entries.length)}
      </div>`;
    }).join("")}
    <button class="button ghost" type="button" data-action="add" data-group="${group}" ${entries.length >= 50 ? "disabled" : ""}>Add ${singular}</button>`;
}

function blockEditor() {
  const order = sectionOrder(draft);
  const layout = draft.appearance.sectionOrder.length ? "custom" : draft.layout;
  return `<div class="block-list">
  <div class="section-tools">
    <label for="layout">Order
      <select id="layout">
        <option value="technical" ${layout === "technical" ? "selected" : ""}>Education first</option>
        <option value="experience" ${layout === "experience" ? "selected" : ""}>Experience first</option>
        <option value="custom" disabled ${layout === "custom" ? "selected" : ""}>Custom</option>
      </select>
    </label>
    <button class="button ghost" type="button" data-action="add-section" ${draft.customSections.length >= MAX_CUSTOM_SECTIONS ? "disabled" : ""}>Add section</button>
  </div>
  <button class="button ghost" type="button" data-action="review-block" hidden>Open block request</button>
  ${order.map((key, index) => {
    const customIndex = draft.customSections.findIndex(row => row.id === key);
    const custom = draft.customSections[customIndex];
    const title = custom ? custom.title || "Custom section" : SECTION_LABELS[key];
    const label = `section-${key}`;
    const group = custom ? "customSections" : key;
    const customAttributes = `data-group="${group}" data-index="${customIndex}"`;
    const singleFields = { headline: "headline", about: "about", skills: "skills", languages: "motherTongue" };
    const single = singleFields[key];
    const multiline = key === "about" || key === "skills";
    return `<div class="section-row">
    <details class="block-card" data-section="${key}" ${openSections.has(key) ? "open" : ""}>
      <summary id="${label}"><span>${escapeText(title)}</span></summary>
      <div class="fields block-fields">
        ${single ? field(key === "languages" ? "Mother tongue" : title, single, draft[single], { multiline, canMark: multiline }) : ""}
        ${custom ? field("Section title", "title", custom.title, { attributes: customAttributes }) +
          field("Section text", "body", custom.body, { attributes: customAttributes, multiline: true, canMark: true }) : ""}
        ${single || custom ? `<div class="entry-actions">
          <button class="button ghost" type="button" data-action="ask-ai" ${custom ? customAttributes : `data-key="${single}"`}>
            ${key === "languages" ? "Ask AI about mother tongue" : "Ask AI"}
          </button>
          ${custom ? `<button class="text-button" type="button" data-action="remove-section" data-key="${key}">Remove section</button>` : ""}
        </div>` : ""}
        ${Object.hasOwn(GROUPS, key) ? `<div>${listEditor(key)}</div>` : ""}
      </div>
    </details>
    ${moveControls("section", `data-key="${key}"`, label, index, order.length)}
    </div>`;
  }).join("")}
  </div>`;
}

function renderEditor(openSection) {
  for (const card of editor.querySelectorAll(".block-card")) {
    if (card.open) openSections.add(card.dataset.section);
    else openSections.delete(card.dataset.section);
  }
  for (const entry of editor.querySelectorAll(".edit-entry")) {
    const row = entryRecords.get(entry);
    if (entry.open) openEntries.add(row);
    else openEntries.delete(row);
  }
  if (openSection) openSections.add(openSection);
  if (activeTab === "blocks") {
    editor.innerHTML = blockEditor();
    for (const entry of editor.querySelectorAll(".edit-entry")) entryRecords.set(entry, fieldRecord(entry.dataset));
  }
  if (activeTab === "personal") editor.innerHTML = personal();
  if (activeTab === "style") editor.innerHTML = stylePanel(editor.querySelector(".theme-options")?.open);
  if (activeTab === "agent") {
    editor.innerHTML = agentPanel();
    syncAgentPanel();
  }
  syncBlockLinks();
}

function section(title, body) {
  return body ? `<section class="cv-section"><h3>${escapeText(title)}</h3>${body}</section>` : "";
}

function previewEntries(cv, group) {
  const entries = cv[group].filter(row => ENTRY_FIELDS.some(field => row[field]?.trim()));
  return section(GROUPS[group][0], entries.map(row => {
    const meta = [row.organisation, row.dates].map(value => value.trim()).filter(Boolean).join(" · ");
    const highlights = row.description.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    return `<div class="cv-entry">
      ${row.title.trim() ? `<h4>${escapeText(row.title.trim())}</h4>` : ""}
      ${meta ? `<p class="cv-meta">${escapeText(meta)}</p>` : ""}
      ${highlights.length ? `<ul>${highlights.map(item => `<li>${escapeText(item)}</li>`).join("")}</ul>` : ""}
    </div>`;
  }).join(""));
}

function languagePreview(cv) {
  const rows = cv.languages.filter(row => row.title.trim()).map(row => {
    const levels = Object.entries(CEFR_FIELDS).filter(([key]) => row[key]).map(([key, label]) => `${label} ${row[key]}`);
    return `<li><strong>${escapeText(row.title.trim())}</strong>${levels.length ? ` · ${levels.join(" · ")}` : ""}</li>`;
  });
  return section("Language skills",
    (cv.motherTongue.trim() ? `<p>Mother tongue · ${escapeText(cv.motherTongue.trim())}</p>` : "") +
    (rows.length ? `<ul class="language-list">${rows.join("")}</ul>` : ""),
  );
}

function renderPaper(target, cv, full = false) {
  const p = full ? cv.personal : cleanDraft().personal;
  const place = [p.postalCode, p.city].map(value => value.trim()).filter(Boolean).join(" ");
  const contact = [p.address, place, p.email, p.phone, p.website].map(value => value.trim()).filter(Boolean).join(" · ");
  const extra = [
    p.birthDate.trim() && "Date of birth " + p.birthDate.trim(),
    p.nationality.trim() && "Nationality " + p.nationality.trim(),
  ].filter(Boolean).join(" · ");
  const renderSection = {
    headline: () => section("Professional headline", cv.headline.trim() ? `<p class="cv-headline">${escapeText(cv.headline.trim())}</p>` : ""),
    about: () => section("About me", cv.about.trim() ? `<p class="cv-text">${escapeText(cv.about.trim())}</p>` : ""),
    skills: () => section("Digital and technical skills", cv.skills.trim() ? `<p class="cv-text">${escapeText(cv.skills.trim())}</p>` : ""),
    languages: () => languagePreview(cv),
  };
  const custom = new Map((cv.customSections ?? []).map(row => [row.id, row]));
  const content = sectionOrder(cv).map(key => {
    if (Object.hasOwn(renderSection, key)) return renderSection[key]();
    if (Object.hasOwn(GROUPS, key)) return previewEntries(cv, key);
    const row = custom.get(key);
    return row?.body.trim() ? section(row.title.trim() || "Custom section", `<p class="cv-text">${escapeText(row.body.trim())}</p>`) : "";
  }).join("");
  const hasContent = Boolean(p.name.trim() || contact || extra || content || p.photo);
  for (const field of ["font", "density", "photoPosition", "headerAlignment", "rules"]) target.dataset[field] = cv.appearance[field];
  target.style.setProperty("--cv-accent", cv.appearance.accent);
  target.style.setProperty("--cv-text", cv.appearance.textColor);
  target.style.setProperty("--cv-size", cv.appearance.fontSize + "pt");
  target.style.setProperty("--cv-line", String(1.4 * cv.appearance.spacing));
  target.style.setProperty("--cv-margin", cv.appearance.margin + "mm");
  target.innerHTML = `<header class="cv-heading">
    <div>
      <h2>${escapeText(p.name.trim() || (full ? "Your name" : "Curriculum vitae"))}</h2>
      ${contact ? `<p class="cv-contact">${escapeText(contact)}</p>` : ""}
      ${extra ? `<p class="cv-contact">${escapeText(extra)}</p>` : ""}
    </div>
    ${p.photo ? `<img class="cv-photo" src="${p.photo}" alt="Profile photo">` :
      !full && draft.personal.photo ? '<div class="cv-photo private-photo" aria-label="Photo withheld">Photo</div>' : ""}
  </header>${content}${hasContent ? "" : '<p class="paper-empty">Add your details to start your CV.</p>'}`;
  return hasContent;
}

function renderPreview() {
  const proposed = reviewingProposal && exchange.proposal?.document && protectedProposal();
  const hasContent = renderPaper(preview, proposed || agentDocument(draft));
  document.querySelector(".privacy-badge").textContent = proposed ? "Redacted proposal" : "Redacted preview";
  printButton.disabled = Boolean(proposed) || !(hasContent || Object.values(draft.personal).some(Boolean));
}

function protectedProposal() {
  return agentDocument({
    ...cleanDraft(exchange.proposal.document),
    personal: draft.personal, terms: draft.terms, vault: { ...draft.vault },
  });
}

function showNotice(message) {
  notice.textContent = message;
  notice.hidden = !message;
}

async function exchangeApi(path, data) {
  const response = await fetch("/api/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: { "X-CV-Client": "browser", ...(data === undefined ? {} : { "Content-Type": "application/json" }) },
    body: data === undefined ? undefined : JSON.stringify(data),
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "The local MCP connection is unavailable.");
  return payload;
}

function blockContent(target) {
  const { group, key, record } = target;
  if (group ? !draft[group].includes(record) : draft !== record) return null;
  const hide = redactor(draft);
  const keys = !group ? [key] : group === "customSections" ? ["title", "body"] : Object.keys(record);
  return Object.fromEntries(keys.map(field => {
    const value = hide(record[field]);
    return [field, group === "languages" && field !== "title" && value !== record[field] ? "" : value];
  }));
}

function showBlockValues(target, block) {
  target.replaceChildren();
  for (const [key, value] of Object.entries(block)) {
    const label = document.createElement("dt");
    const text = document.createElement("dd");
    label.textContent = SECTION_LABELS[key] ?? CEFR_FIELDS[key] ?? key;
    text.textContent = value || "—";
    target.append(label, text);
  }
}

function ownBlockRequest() {
  return queuedBlock?.id === exchange.request?.id && queuedBlock;
}

function syncBlockLinks() {
  const current = ownBlockRequest();
  for (const button of editor.querySelectorAll('[data-action="review-block"]')) {
    button.hidden = !current;
    button.textContent = exchange.proposal?.block ? "Review AI revision" : "View AI request";
  }
}

function syncBlockPanel() {
  if (!aiDialog.open || !aiBlock) return;
  const owned = ownBlockRequest();
  const isCurrent = owned && owned.target.record === aiBlock.record && owned.target.key === aiBlock.key;
  const current = blockContent(aiBlock);
  const proposal = isCurrent && exchange.proposal?.block;
  const safeInstruction = redactor(draft)(aiInstruction.value.trim());
  document.querySelector("#block-ai-share").textContent = [safeInstruction, current && JSON.stringify(current, null, 2)].filter(Boolean).join("\n\n");
  aiQueue.textContent = exchange.request ? "Replace now" : "Send via MCP";
  aiQueue.disabled = !exchangeReady || exchangeBusy || !current || !safeInstruction;
  aiNext.hidden = !owned;
  aiNext.textContent = nextBlock ? "Remove follow-up" : "Send after current";
  aiNext.disabled = exchangeBusy || (!nextBlock && (!current || !safeInstruction));
  aiCancel.hidden = !isCurrent;
  aiCancel.disabled = exchangeBusy;
  aiCancel.textContent = proposal ? "Discard proposal" : "Cancel request";
  aiProposal.hidden = !proposal;
  let validationError = "";
  if (proposal) {
    showBlockValues(document.querySelector("#block-ai-before"), exchange.request.block);
    const hide = redactor({ ...draft, vault: { ...draft.vault } });
    showBlockValues(document.querySelector("#block-ai-after"), Object.fromEntries(
      Object.entries(proposal).map(([key, value]) => [key, hide(value)]),
    ));
    const note = document.querySelector("#block-ai-note");
    note.textContent = redactor(draft)(exchange.proposal.note ?? "");
    note.hidden = !note.textContent;
    try { checkedReply(aiBlock, exchange.request.block, proposal); }
    catch (error) { validationError = error.message; }
  }
  aiApply.disabled = exchangeBusy || !!validationError;
  const status = aiFailure || validationError || (!exchangeReady ? "Checking the local MCP service…"
    : proposal ? "Proposal ready to review."
    : isCurrent ? (exchange.request.retrieved ? "Your agent has retrieved this request." : "Queued. Run Process Local CV Maker request in your connected agent.")
    : exchange.request ? "A request is already active."
    : "Send the request, then run Process Local CV Maker request in your connected agent.")
    + (nextBlock ? " A follow-up is queued for after review." : "");
  if (aiStatus.textContent !== status) aiStatus.textContent = status;
}

function askBlockAi(target) {
  const record = target.record ?? fieldRecord(target);
  if (!record) return;
  aiBlock = { ...target, record };
  const owned = ownBlockRequest();
  aiInstruction.value = owned?.target.record === record && owned.target.key === target.key
    ? owned.instruction : "Improve clarity and wording while keeping the facts.";
  aiFailure = "";
  if (!aiDialog.open) aiDialog.showModal();
  syncBlockPanel();
  aiInstruction.focus();
  void refreshExchange();
}

function checkedReply(target, original, reply) {
  if (!sameDocument(original, blockContent(target))) {
    throw new Error("This block changed after the request was sent. Send a new request to use its current text.");
  }
  return validateBlockReply(draft, original, JSON.stringify(reply));
}

async function sendBlock(target, instruction, previousId) {
  const block = blockContent(target);
  if (!block) throw new Error("This block was removed.");
  const safeInstruction = redactor(draft)(instruction);
  saveDraft();
  const next = await exchangeApi("block-request", { instruction: safeInstruction, block, previousId });
  queuedBlock = { id: next.request.id, target, instruction: safeInstruction };
  showExchange(next);
}

async function editBlockRequest(action) {
  if (exchangeBusy || !aiBlock) return;
  const target = aiBlock;
  const typed = aiInstruction.value.trim();
  const active = exchange.request;
  const owned = ownBlockRequest();
  aiFailure = "";
  if (action === "next") {
    if (!owned) return;
    if (nextBlock) nextBlock = null;
    else if (typed) nextBlock = { target, instruction: redactor(draft)(typed) };
    syncBlockPanel();
    return;
  }
  if (action === "send" && active && !confirm("Replace the active MCP request? Any later reply to it will be declined.")) return;
  if (action !== "send" && (!owned || owned.target.record !== target.record || owned.target.key !== target.key)) return;
  exchangeBusy = true;
  exchangeGeneration++;
  syncExchangeControls();
  try {
    if (action === "send") {
      await sendBlock(target, typed, active?.id ?? null);
      nextBlock = null;
    } else {
      const proposal = exchange.proposal?.block;
      if (action === "apply") checkedReply(target, active.block, proposal);
      showExchange(await exchangeApi("clear", { id: active.id }));
      if (action === "apply") {
        Object.assign(target.record, checkedReply(target, active.block, proposal));
        syncMaskedFields();
        changed();
        saveDraft();
        showNotice("AI revision applied to this block.");
      }
      const followUp = nextBlock;
      if (followUp) {
        await sendBlock(followUp.target, followUp.instruction, null);
        nextBlock = null;
        askBlockAi(followUp.target);
      } else if (aiDialog.open) aiDialog.close();
    }
  } catch (error) {
    if (aiDialog.open) aiFailure = error.message;
    else showNotice(error.message);
  } finally {
    exchangeBusy = false;
    syncExchangeControls();
    void refreshExchange();
  }
}

aiInstruction.addEventListener("input", () => {
  aiFailure = "";
  syncBlockPanel();
});
aiQueue.addEventListener("click", () => void editBlockRequest("send"));
aiNext.addEventListener("click", () => void editBlockRequest("next"));
aiCancel.addEventListener("click", () => void editBlockRequest("cancel"));
aiApply.addEventListener("click", () => void editBlockRequest("apply"));
aiDialog.addEventListener("cancel", event => {
  if (exchangeBusy) event.preventDefault();
});

const connectionDialog = document.querySelector("#ai-connection");
const clientType = document.querySelector("#ai-client");
const setupValue = document.querySelector("#ai-setup");
const setupStatus = document.querySelector("#ai-setup-status");
let connectionSettings;

function renderConnectionSettings() {
  const settings = connectionSettings;
  if (!settings) return;
  const useHttp = clientType.value === "http";
  document.querySelector("#ai-setup-help").textContent = useHttp
    ? "Enter the server URL and Authorization header in your local client’s Streamable HTTP settings."
    : "Use the command and argument shown below in your client’s stdio settings.";
  setupValue.value = JSON.stringify(useHttp
    ? { url: settings.url, headers: { Authorization: "Bearer " + settings.token } }
    : { command: settings.command, args: ["--mcp"] }, null, 2);
}

async function openConnection() {
  setupStatus.textContent = "Loading local connection settings…";
  setupValue.value = "";
  connectionDialog.showModal();
  try {
    connectionSettings = await exchangeApi("connection", {});
    renderConnectionSettings();
    setupStatus.textContent = "";
  } catch (error) {
    setupStatus.textContent = error.message;
  }
}
document.querySelector("#connect-ai").addEventListener("click", () => void openConnection());
document.querySelector("#block-ai-connect").addEventListener("click", () => void openConnection());
clientType.addEventListener("change", renderConnectionSettings);
document.querySelector("#copy-ai-setup").addEventListener("click", async () => {
  if (!setupValue.value) return;
  try {
    await navigator.clipboard.writeText(setupValue.value);
    setupStatus.textContent = "Connection settings copied.";
  } catch {
    setupValue.select();
    setupStatus.textContent = "Press Ctrl+C to copy the selected connection settings.";
  }
});

function syncAgentPanel() {
  const connection = editor.querySelector("#agent-status");
  if (!connection) return;
  editor.querySelector("#agent-instruction-preview").textContent = redactor(draft)(instruction) || "Enter a request to preview it here.";
  const block = exchange.request?.kind === "block";
  connection.textContent = !exchangeReady ? "MCP service unavailable. Start the Windows executable."
    : block ? "A block request is active."
    : exchange.proposal ? "Proposal ready for review."
    : exchange.request ? "Request queued. Run Process Local CV Maker request in your connected agent."
    : "No live request.";
  editor.querySelector("#proposal-actions").hidden = block || !exchange.proposal;
  editor.querySelector("#clear-request").hidden = !exchange.request || !!ownBlockRequest();
  const note = editor.querySelector("#proposal-note");
  note.hidden = block || !exchange.proposal?.note;
  note.textContent = !block && exchange.proposal?.note ? redactor(draft)(exchange.proposal.note) : "";
  editor.querySelector('[data-action="queue-request"]').disabled = !exchangeReady || exchangeBusy;
}

function syncExchangeControls() {
  syncAgentPanel();
  syncBlockLinks();
  syncBlockPanel();
}

function showExchange(next) {
  if (exchange.request?.id !== next.request?.id || !next.proposal) reviewingProposal = false;
  exchange = next;
  renderPreview();
  syncExchangeControls();
}

async function refreshExchange() {
  if (exchangeBusy || (activeTab !== "agent" && !aiDialog.open && !exchange.request)) return;
  const generation = ++exchangeGeneration;
  try {
    const next = await exchangeApi("exchange");
    if (generation !== exchangeGeneration) return;
    exchangeReady = true;
    showExchange(next);
  } catch {
    if (generation !== exchangeGeneration) return;
    exchangeReady = false;
    syncExchangeControls();
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, canonical(value[key])]),
  );
  return value;
}

function sameDocument(first, second) {
  return JSON.stringify(canonical(first)) === JSON.stringify(canonical(second));
}

async function editExchange(action) {
  if (exchangeBusy) return;
  if (action === "preview-proposal") {
    reviewingProposal = Boolean(exchange.proposal) && !reviewingProposal;
    renderPreview();
    return;
  }
  if (action === "queue-request" && !instruction.trim()) {
    showNotice("Enter an editing or styling request first.");
    return;
  }
  if (action === "queue-request" && exchange.request && !confirm("Replace the current local MCP request?")) return;
  if (action === "apply-proposal" && (!exchange.proposal || !sameDocument(agentDocument(draft), exchange.request.document))) {
    showNotice("The CV changed after you queued the request. Queue a fresh request to keep your edits.");
    return;
  }
  if (action === "apply-proposal") {
    if (!sameDocument(protectedProposal(), exchange.proposal.document)) {
      showNotice("The proposal contains personal text or unsupported fields. Ask the agent to keep the placeholders.");
      return;
    }
  }
  exchangeBusy = true;
  exchangeGeneration++;
  syncAgentPanel();
  try {
    if (action === "queue-request") {
      maskBody();
      const safeInstruction = redactor(draft)(instruction.trim());
      saveDraft();
      showExchange(await exchangeApi("request", { instruction: safeInstruction, document: agentDocument(draft), previousId: exchange.request?.id ?? null }));
      nextBlock = null;
      showNotice("Redacted request queued.");
    } else if (exchange.request) {
      const original = exchange.request.document;
      const document = exchange.proposal?.document;
      showExchange(await exchangeApi("clear", { id: exchange.request.id }));
      if (action === "apply-proposal" && document) {
        if (!sameDocument(agentDocument(draft), original)) {
          showNotice("The CV changed while applying the proposal. Your current edits were kept.");
          return;
        }
        applyDocument(draft, document);
        changed();
        saveDraft();
        showNotice("Proposal applied. Personal values remain hidden until export.");
      } else showNotice("Live request cleared.");
    }
  } catch (error) {
    showNotice(error.message);
  } finally {
    exchangeBusy = false;
    syncExchangeControls();
    void refreshExchange();
  }
}

function selectTab(tab) {
  maskBody();
  activeTab = tab.dataset.tab;
  for (const button of tabs) {
    button.setAttribute("aria-selected", String(button === tab));
    button.tabIndex = button === tab ? 0 : -1;
  }
  editor.setAttribute("aria-labelledby", tab.id);
  showNotice("");
  renderEditor();
  if (activeTab === "agent") void refreshExchange();
}

for (const tab of tabs) {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", event => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step && !["Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 :
      (tabs.indexOf(tab) + step + tabs.length) % tabs.length;
    selectTab(tabs[index]);
    tabs[index].focus();
  });
}

editor.addEventListener("input", event => {
  if (event.target.id === "agent-instruction") {
    instruction = event.target.value;
    syncAgentPanel();
    return;
  }
  const { field, group, style } = event.target.dataset;
  if (style) {
    const value = event.target.type === "number" ? event.target.valueAsNumber : event.target.value;
    if (event.target.validity.valid) {
      draft.appearance = cleanAppearance({ ...draft.appearance, [style]: value }, draft.customSections);
      for (const button of editor.querySelectorAll('[data-action="theme"]')) {
        button.setAttribute("aria-pressed", String(matchesTheme(THEMES[button.dataset.key][1])));
      }
      changed();
    }
    return;
  }
  if (!field) return;
  const record = fieldRecord(event.target.dataset);
  record[field] = event.target.value;
  if (group && field === "title") updateBlockTitle(event.target, group, event.target.value);
  changed();
});

editor.addEventListener("focusout", event => {
  const { field, group, personal, style } = event.target.dataset;
  if (style && event.target.type === "number") event.target.value = draft.appearance[style];
  if (!field || personal || event.target.tagName === "SELECT" || event.relatedTarget?.dataset.action === "mark-text") return;
  const record = fieldRecord(event.target.dataset);
  const safe = redactor(draft)(record[field]);
  if (safe === record[field]) return;
  record[field] = safe;
  event.target.value = safe;
  if (group && field === "title") updateBlockTitle(event.target, group, safe);
  changed();
});

function registerTerm(text) {
  const error = addTerm(draft, text);
  showNotice(error || "Private term added. Check the redacted preview.");
  if (!error) {
    maskBody();
    syncMaskedFields();
    changed();
  }
  return !error;
}

function registerManualTerm() {
  const input = editor.querySelector("#private-term");
  if (registerTerm(input.value)) {
    renderEditor();
    editor.querySelector("#private-term").focus();
  }
}

editor.addEventListener("keydown", event => {
  if (event.key === "Enter" && event.target.id === "private-term") {
    event.preventDefault();
    registerManualTerm();
  }
});

editor.addEventListener("click", event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, group, index, key } = button.dataset;
  if (["queue-request", "preview-proposal", "apply-proposal", "clear-request"].includes(action)) {
    void editExchange(action);
    return;
  }
  if (action === "ask-ai") {
    askBlockAi({ group, index, key });
    return;
  }
  if (action === "review-block") {
    if (ownBlockRequest()) askBlockAi(queuedBlock.target);
    return;
  }
  if (action === "theme") {
    draft.appearance = cleanAppearance({ ...draft.appearance, ...THEMES[key][1] }, draft.customSections);
    renderEditor();
    editor.querySelector(`[data-action="theme"][data-key="${key}"]`).focus();
    changed();
    return;
  }
  if (action === "add-section") {
    if (draft.customSections.length >= MAX_CUSTOM_SECTIONS) return;
    let next = 1;
    while (draft.customSections.some(row => row.id === "custom-" + next)) next++;
    const id = "custom-" + next;
    draft.customSections.push({ id, title: "", body: "" });
    renderEditor(id);
    editor.querySelector(`[data-section="${id}"] input`).focus();
    changed();
    return;
  }
  if (action === "remove-section") {
    const row = draft.customSections.find(item => item.id === key);
    if (!row || ((row.title || row.body) && !confirm("Remove this custom section?"))) return;
    editor.querySelector(`[data-section="${key}"]`).closest(".section-row").remove();
    openSections.delete(key);
    draft.customSections = draft.customSections.filter(item => item.id !== key);
    draft.appearance.sectionOrder = draft.appearance.sectionOrder.filter(id => id !== key);
    renderEditor();
    editor.querySelector('[data-action="add-section"]').focus();
    changed();
    return;
  }
  if (action === "section-up" || action === "section-down") {
    const order = sectionOrder(draft);
    const position = order.indexOf(key);
    const next = position + (action === "section-up" ? -1 : 1);
    [order[position], order[next]] = [order[next], order[position]];
    draft.appearance.sectionOrder = order;
    renderEditor();
    focusMovedRow(editor.querySelector(`[data-section="${key}"]`), action);
    changed();
    return;
  }
  if (action === "mark-text") {
    const field = button.closest(".markable").querySelector("textarea");
    registerTerm(field.value.slice(field.selectionStart, field.selectionEnd));
    return;
  }
  if (action === "add-term") {
    registerManualTerm();
    return;
  }
  if (action === "remove-term") {
    draft.terms.splice(Number(index), 1);
    renderEditor();
    editor.querySelector("#private-term").focus();
    showNotice("Term removed. Review your redacted preview before sharing.");
    changed();
    return;
  }
  if (action === "private-backup") {
    if (confirm("Save a full backup? This file includes personal information and the photo in unencrypted JSON.")) {
      saveBackup(true);
    }
    return;
  }
  if (action === "choose-photo") {
    editor.querySelector("#photo-file").click();
    return;
  }
  if (action === "remove-photo") {
    draftRevision++;
    draft.personal.photo = "";
    renderEditor();
    editor.querySelector('[data-action="choose-photo"]').focus();
    changed();
    return;
  }
  const rows = draft[group];
  if (!rows) return;
  const position = Number(index);
  let newPosition;
  if (action === "add" && rows.length < 50) {
    rows.push(group === "languages" ? Object.fromEntries(["title", ...Object.keys(CEFR_FIELDS)].map(field => [field, ""])) :
      Object.fromEntries(ENTRY_FIELDS.map(field => [field, ""])));
    newPosition = rows.length - 1;
    openEntries.add(rows[newPosition]);
  } else if (action === "remove") {
    rows.splice(position, 1);
  } else if (action === "up" || action === "down") {
    newPosition = position + (action === "up" ? -1 : 1);
    [rows[position], rows[newPosition]] = [rows[newPosition], rows[position]];
  }
  renderEditor();
  const entry = editor.querySelector(`.edit-entry[data-group="${group}"][data-index="${newPosition}"]`);
  if (action === "add") entry.querySelector("input").focus();
  else if (entry) focusMovedRow(entry, action);
  else editor.querySelector(`[data-action="add"][data-group="${group}"]`)?.focus();
  changed();
});

function focusMovedRow(details, action) {
  const controls = details.nextElementSibling;
  (controls.querySelector(`[data-action="${action}"]:enabled`)
    ?? controls.querySelector("button:enabled")
    ?? details.querySelector("summary")).focus();
}

editor.addEventListener("change", async event => {
  if (event.target.id === "layout") {
    draft.layout = event.target.value;
    draft.appearance.sectionOrder = [];
    renderEditor();
    editor.querySelector("#layout").focus();
    changed();
    return;
  }
  if (event.target.id !== "photo-file" || !event.target.files[0]) return;
  const file = event.target.files[0];
  event.target.value = "";
  const revision = ++draftRevision;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 12 * 1024 * 1024) {
    status.textContent = "Choose a JPG, PNG or WebP photo up to 12 MB.";
    return;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 584;
    const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    bitmap.close();
    if (revision !== draftRevision) return;
    draft.personal.photo = canvas.toDataURL("image/jpeg", 0.88);
    if (activeTab === "personal") renderEditor();
    changed();
  } catch {
    if (revision === draftRevision) status.textContent = "This image could not be opened.";
  }
});

function loadDraft(source) {
  draftRevision++;
  draft = cleanDraft(source);
  maskBody();
  reviewingProposal = false;
  editor.replaceChildren();
  openSections.clear();
  openSections.add("about");
  selectTab(tabs[0]);
  renderPreview();
  saveDraft();
}

document.querySelector("#reset-draft").addEventListener("click", () => {
  if (confirm("Start a blank CV? This replaces the current browser draft.")) loadDraft({});
});
document.querySelector("#load-example").addEventListener("click", () => {
  if (confirm("Load the fictional example? This replaces the current browser draft.")) loadDraft(EXAMPLE);
});

function saveBackup(full) {
  maskBody();
  const backup = new Blob([JSON.stringify({
    format: "local-cv-maker",
    version: 2,
    draft: full ? draft : agentDocument(draft),
  }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(backup);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = full ? "cv-private-draft.json" : "cv-redacted-draft.json";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.querySelector("#save-backup").addEventListener("click", () => {
  fileMenu.open = false;
  fileMenu.querySelector("summary").focus();
  saveBackup(false);
});
document.querySelector("#load-backup").addEventListener("click", () => {
  fileMenu.open = false;
  fileMenu.querySelector("summary").focus();
  backupInput.click();
});
backupInput.addEventListener("change", async () => {
  const file = backupInput.files[0];
  backupInput.value = "";
  if (!file) return;
  saveDraft();
  try {
    if (file.size > 4 * 1024 * 1024) throw new Error("Backup is too large.");
    const backup = JSON.parse(await file.text());
    if (backup?.format !== "local-cv-maker" || backup.version !== 2 ||
        !backup.draft || typeof backup.draft !== "object" || Array.isArray(backup.draft)) {
      throw new Error("Choose a backup created by CV Maker.");
    }
    if (confirm("Open this backup? This replaces the current browser draft.")) loadDraft(backup.draft);
  } catch (error) {
    status.textContent = error instanceof SyntaxError ? "This backup is not valid JSON." : error.message;
  }
});

function clearPrint() {
  document.querySelector(".print-export")?.remove();
  document.body.classList.remove("exporting");
  document.title = "Local CV Maker";
}

printButton.addEventListener("click", async () => {
  if (reviewingProposal || document.querySelector(".print-export")) return;
  const safe = agentDocument(draft);
  const tokens = Object.values(safe).flatMap(value => JSON.stringify(value).match(TOKEN) || []);
  if (tokens.some(token => !Object.hasOwn(draft.vault, token))) {
    showNotice("Some placeholders have no private value in this draft. They will remain redacted in the PDF.");
    if (!confirm("Some placeholders cannot be restored. Export with those placeholders still redacted?")) return;
  }
  const paper = document.createElement("article");
  paper.className = "paper print-export";
  renderPaper(paper, toExport(draft, safe), true);
  document.body.append(paper);
  document.body.classList.add("exporting");
  const portrait = paper.querySelector("img");
  await portrait?.decode().catch(() => {});
  document.title = "CV - full";
  window.print();
});
window.addEventListener("afterprint", clearPrint);
window.addEventListener("pagehide", () => {
  if (saveTimer !== null) saveDraft();
});

maskBody();
renderEditor();
renderPreview();
saveDraft();
setInterval(() => void refreshExchange(), 1200);
