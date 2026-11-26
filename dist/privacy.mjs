export const PERSONAL_FIELDS = [
  "name", "email", "phone", "address", "postalCode", "city", "website",
  "birthDate", "nationality", "photo",
];
export const CONTENT_FIELDS = ["headline", "about", "motherTongue", "skills"];
export const GROUPS = {
  work: ["Work experience", "role", "Employer"],
  education: ["Education and training", "qualification", "Institution"],
  projects: ["Selected projects", "project", "Organisation or project type"],
  languages: ["Languages", "language"],
};
export const ENTRY_FIELDS = ["title", "organisation", "dates", "description"];
export const CEFR_FIELDS = {
  listening: "Listening", reading: "Reading", production: "Spoken production",
  interaction: "Spoken interaction", writing: "Writing",
};
export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
export const SECTIONS = ["about", "education", "projects", "work", "skills", "languages"];
export const MAX_CUSTOM_SECTIONS = 30;
const CUSTOM_SECTION_ID = /^custom-[1-9]\d{0,5}(?![\s\S])/;
export const MAX_TERMS = 100;
export const TOKEN = /\[\[PII_\d{4}\]\]/g;
const MAX_TERM_LENGTH = 250;
const WORD = /[\p{L}\p{M}\p{N}_]/u;
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu;
const WEB_LINK = /(?:https?:\/\/|www\.)[^\s<>"'\[\]{}()]+/giu;
const PHONE = /(?<![\p{L}\p{N}])(?:\+[0-9]{8,15}|(?:\+[0-9]{1,3}[ .-]?)?(?:\([0-9]{2,4}\)[ .-]?|[0-9]{2,4}[ .-])[0-9]{3,4}[ .-]?[0-9]{4})(?![\p{L}\p{N}])/gu;

const text = value => typeof value === "string" ? value : "";
const normalized = value => value.normalize("NFC").trim().replace(/\s+/gu, " ");

export function cleanDraft(source = {}) {
  const personal = Object.fromEntries(PERSONAL_FIELDS.map(field => [field, text(source.personal?.[field]).slice(0, 250)]));
  const photo = source.personal?.photo;
  personal.photo = typeof photo === "string" && photo.length <= 950000 &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(photo) ? photo : "";

  const result = Object.fromEntries(CONTENT_FIELDS.map(field => [field, text(source[field])]));
  result.personal = personal;
  result.layout = source.layout === "experience" ? "experience" : "technical";
  result.customSections = [];
  const usedIds = new Set();
  for (const row of Array.isArray(source.customSections) ? source.customSections.slice(0, MAX_CUSTOM_SECTIONS) : []) {
    if (typeof row?.id !== "string" || !CUSTOM_SECTION_ID.test(row.id) || usedIds.has(row.id)) continue;
    usedIds.add(row.id);
    result.customSections.push({ id: row.id, title: text(row.title), body: text(row.body) });
  }
  result.appearance = cleanAppearance(source.appearance, result.customSections);
  result.vault = Object.fromEntries(Object.entries(source.vault || {}).filter(([key, value]) =>
    /^\[\[PII_\d{4}\]\]$/.test(key) && typeof value === "string",
  ));
  result.terms = [];
  for (const term of Array.isArray(source.terms) ? source.terms.slice(0, MAX_TERMS) : []) addTerm(result, term);

  for (const group of Object.keys(GROUPS)) {
    const fields = group === "languages" ? ["title", ...Object.keys(CEFR_FIELDS)] : ENTRY_FIELDS;
    result[group] = Array.isArray(source[group]) ? source[group].slice(0, 50).map(row =>
      Object.fromEntries(fields.map(field => {
        const value = row?.[field];
        if (group === "languages" && field !== "title") return [field, LEVELS.includes(value) ? value : ""];
        return [field, text(value)];
      })),
    ) : [];
  }
  return result;
}

export function cleanAppearance(source = {}, customSections = []) {
  const select = (value, choices) => choices.includes(value) ? value : choices[0];
  const number = (value, fallback, minimum, maximum) =>
    typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : fallback;
  const color = (value, fallback) => typeof value === "string" && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
  const customIds = customSections.map(row => row.id);
  const allowed = [...SECTIONS, ...customIds, "headline"];
  const order = Array.isArray(source?.sectionOrder) ? source.sectionOrder : [];
  const validOrder = new Set(order).size === order.length &&
    order.every(key => allowed.includes(key)) && SECTIONS.every(key => order.includes(key));
  return {
    accent: color(source?.accent, "#1d5370"),
    textColor: color(source?.textColor, "#243644"),
    font: select(source?.font, ["sans", "serif", "humanist"]),
    density: select(source?.density, ["balanced", "compact", "spacious"]),
    photoPosition: select(source?.photoPosition, ["right", "left"]),
    headerAlignment: select(source?.headerAlignment, ["left", "center"]),
    rules: select(source?.rules, ["thin", "none", "heavy"]),
    fontSize: number(source?.fontSize, 10, 9, 13),
    spacing: number(source?.spacing, 1, 0.7, 1.5),
    margin: number(source?.margin, 16, 10, 22),
    sectionOrder: validOrder ? [...order] : [],
  };
}

export function addTerm(draft, input) {
  if (typeof input !== "string") return "Enter or select the text you want to hide.";
  const term = normalized(input);
  if (!term) return "Enter or select the text you want to hide.";
  if (/\[\[PII_\d{4}\]\]/.test(term)) return "Select the original private text, without a placeholder.";
  if (term.length > MAX_TERM_LENGTH) return "Choose a word or phrase of up to 250 characters.";
  if (draft.terms.some(existing => existing.toLowerCase() === term.toLowerCase())) return "That term is already marked private.";
  if (draft.terms.length >= MAX_TERMS) return "You can mark up to 100 private terms.";
  draft.terms.push(term);
  return "";
}

function matcher(phrase) {
  const term = normalized(phrase);
  const characters = Array.from(term);
  if (!characters.length) return null;
  const pattern = term.split(" ").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const left = WORD.test(characters[0]) ? "(?<![\\p{L}\\p{M}\\p{N}_])" : "";
  const right = WORD.test(characters.at(-1)) ? "(?![\\p{L}\\p{M}\\p{N}_])" : "";
  return new RegExp(left + pattern + right, "giu");
}

function phoneMatcher(value) {
  const digits = value.replace(/[^0-9]/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return new RegExp("(?<![0-9])\\+?\\(?" + [...digits].join("[ ().-]*") + "(?![0-9])", "g");
}

export function textLength(value) {
  return value.replace(TOKEN, "x").length;
}

export function redactor(draft) {
  const matches = [
    ...draft.terms, ...PERSONAL_FIELDS.filter(field => field !== "photo").map(field => draft.personal[field]),
  ].map(matcher).concat(phoneMatcher(draft.personal.phone)).filter(Boolean).concat(EMAIL, WEB_LINK, PHONE);
  const used = new Set(Object.keys(draft.vault));
  const byValue = new Map(Object.entries(draft.vault).map(([token, value]) => [value, token]));
  const reserve = value => {
    for (const token of value.match(TOKEN) ?? []) used.add(token);
  };
  for (const field of CONTENT_FIELDS) reserve(draft[field]);
  for (const group of Object.keys(GROUPS)) for (const row of draft[group]) Object.values(row).forEach(reserve);
  for (const row of draft.customSections) { reserve(row.title); reserve(row.body); }
  let nextId = 1;
  const privateValue = value => {
    if (byValue.has(value)) return byValue.get(value);
    // Drafts may contain placeholders from a redacted backup that has no vault.
    while (nextId <= 9999) {
      const token = "[[PII_" + String(nextId++).padStart(4, "0") + "]]";
      if (used.has(token)) continue;
      used.add(token);
      byValue.set(value, token);
      draft.vault[token] = value;
      return token;
    }
    throw new Error("This draft has reached its private placeholder limit.");
  };

  const hide = input => {
    const spans = matches.flatMap(pattern => Array.from(input.matchAll(pattern), match => [
      match.index, match.index + match[0].length,
    ])).sort((first, second) => first[0] - second[0]);
    let result = "";
    let cursor = 0;
    for (let index = 0; index < spans.length; index++) {
      const [start, end] = spans[index];
      let stop = end;
      while (index + 1 < spans.length && spans[index + 1][0] < stop) {
        stop = Math.max(stop, spans[++index][1]);
      }
      result += input.slice(cursor, start) + privateValue(input.slice(start, stop));
      cursor = stop;
    }
    return result + input.slice(cursor);
  };
  return value => {
    reserve(value);
    return value.split(/(\[\[PII_\d{4}\]\])/g)
      .map((part, index) => index % 2 ? part : hide(part.normalize("NFC"))).join("");
  };
}

export function agentDocument(draft) {
  const replace = redactor(draft);
  const result = {};
  for (const field of CONTENT_FIELDS) result[field] = replace(draft[field]);
  result.layout = draft.layout;
  result.appearance = cleanAppearance(draft.appearance, draft.customSections);
  if (draft.customSections.length) {
    result.customSections = draft.customSections.map(({ id, title, body }) => ({
      id, title: replace(title), body: replace(body),
    }));
  }
  for (const group of Object.keys(GROUPS)) {
    result[group] = draft[group].map(row => Object.fromEntries(Object.entries(row).map(([field, value]) => [
      field, group === "languages" && field !== "title" && replace(value) !== value ? "" : replace(value),
    ])));
  }
  return result;
}

export function applyDocument(draft, document) {
  for (const field of [...CONTENT_FIELDS, ...Object.keys(GROUPS), "layout", "appearance"]) {
    draft[field] = document[field];
  }
  draft.customSections = document.customSections ?? [];
}

export function toExport(draft, document) {
  const restore = value => value.replace(TOKEN, token => draft.vault[token] ?? token);
  const result = { ...document, personal: draft.personal };
  for (const field of CONTENT_FIELDS) result[field] = restore(document[field]);
  for (const group of Object.keys(GROUPS)) {
    result[group] = document[group].map(row => Object.fromEntries(
      Object.entries(row).map(([field, value]) => [field, restore(value)]),
    ));
  }
  result.customSections = (document.customSections ?? []).map(({ id, title, body }) => ({
    id, title: restore(title), body: restore(body),
  }));
  return result;
}

export function validateBlockReply(draft, original, input) {
  let reply;
  try {
    const json = input.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
    reply = JSON.parse(json);
  } catch {
    throw new Error("The agent returned an invalid block revision.");
  }
  const keys = Object.keys(original);
  if (!reply || typeof reply !== "object" || Array.isArray(reply) ||
      Object.keys(reply).length !== keys.length || !keys.every(key => Object.hasOwn(reply, key))) {
    throw new Error("The reply must contain exactly the fields shown in the block.");
  }
  const hide = redactor({ ...draft, vault: { ...draft.vault } });
  for (const key of keys) {
    const value = reply[key];
    if (typeof value !== "string" || textLength(value) > (["about", "skills", "description", "body"].includes(key) ? 4000 : 250) ||
        (Object.hasOwn(CEFR_FIELDS, key) && value !== "" && !LEVELS.includes(value))) {
      throw new Error("The reply has an invalid value for " + key + ".");
    }
    if (hide(value) !== value.normalize("NFC")) throw new Error("The reply contains private text. Ask the AI to use the existing placeholders.");
  }
  const tokens = value => (JSON.stringify(value).match(TOKEN) ?? []).sort().join(",");
  if (tokens(original) !== tokens(reply)) throw new Error("The reply must preserve every private placeholder in this block.");
  return Object.fromEntries(keys.map(key => [key, reply[key].normalize("NFC")]));
}
