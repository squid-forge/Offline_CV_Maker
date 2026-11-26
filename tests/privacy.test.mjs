import { test } from "node:test";
import { strict as assert } from "node:assert";
import { addTerm, agentDocument, applyDocument, cleanDraft, redactor, toExport, validateBlockReply } from "../dist/privacy.mjs";

test("the agent document carries placeholders and no vault, personal fields or real photo", () => {
  const draft = cleanDraft({
    personal: { name: "Sample Person", city: "Example City", email: "example@example.invalid", photo: "data:image/jpeg;base64,AAAA" },
    terms: ["Org X", "X North"],
    headline: "Contact SAMPLE PERSON at example@example.invalid",
    about: "Visited Example City and Org X North. Email another@sample.invalid.",
    work: [{ title: "Engineer", organisation: "Org X", dates: "20XX", description: "Worked with Org X." }],
  });
  const body = agentDocument(draft);
  const json = JSON.stringify(body);
  for (const value of ["personal", '"photo":', "vault", "terms", "SAMPLE PERSON", "Example City", "Org X", "@", "North"]) {
    assert.ok(!json.includes(value), value);
  }
  assert.equal(Object.keys(body).includes("personal"), false);
  assert.match(body.about, /\[\[PII_\d{4}\]\]/);
  assert.deepEqual(agentDocument(draft), body);
  const restored = toExport(draft, body);
  assert.equal(restored.about, draft.about);
  assert.equal(restored.headline, draft.headline);
  assert.equal(restored.work[0].organisation, "Org X");
  assert.equal(restored.personal.photo, draft.personal.photo);
});

test("term matching is literal, case-insensitive, boundary-aware and spans whitespace", () => {
  const draft = cleanDraft({ terms: ["ACME+", "Ann", "Müller Labs"] });
  const masked = redactor(draft)("Acme+ with Joanne and ANN at Mu\u0308ller\nLabs.");
  assert.match(masked, /Joanne/);
  assert.doesNotMatch(masked, /Acme\+|ANN|Labs/u);
  assert.equal((masked.match(/\[\[PII_\d{4}\]\]/g) || []).length, 3);
  assert.equal(addTerm(draft, " ACME+ "), "That term is already marked private.");
});

test("an agent revision retains the same placeholder values and can restyle the draft", () => {
  const draft = cleanDraft({ about: "Worked with Example Laboratory.", terms: ["Example Laboratory"] });
  const doc = agentDocument(draft);
  const token = doc.about.match(/\[\[PII_\d{4}\]\]/)[0];
  applyDocument(draft, { ...doc, about: "Validated tests with " + token + ".", appearance: { ...doc.appearance, accent: "#284b71" } });
  const exported = toExport(draft, agentDocument(draft));
  assert.equal(exported.about, "Validated tests with Example Laboratory.");
  assert.equal(exported.appearance.accent, "#284b71");
  assert.ok(draft.about.includes(token));
});

test("redacted backups can be opened without restoring unknown placeholders", () => {
  const draft = cleanDraft({ about: "A draft with [[PII_0038]].", appearance: { rules: "heavy", fontSize: 11.5 } });
  assert.equal(toExport(draft, agentDocument(draft)).about, "A draft with [[PII_0038]].");
  assert.equal(draft.appearance.rules, "heavy");
  assert.equal(draft.appearance.fontSize, 11.5);
});

test("custom section titles and bodies are redacted, restored and kept in their chosen order", () => {
  const order = ["about", "custom-1", "education", "projects", "work", "skills", "languages", "headline"];
  const draft = cleanDraft({
    personal: { name: "Ada Example" },
    appearance: { sectionOrder: order },
    customSections: [{ id: "custom-1", title: "Ada Example awards", body: "Winner: Ada Example." }],
  });
  const safe = agentDocument(draft);
  assert.deepEqual(safe.appearance.sectionOrder, order);
  assert.doesNotMatch(JSON.stringify(safe), /Ada Example/);
  assert.deepEqual(toExport(draft, safe).customSections, draft.customSections);
  assert.deepEqual(agentDocument(cleanDraft(safe)), safe);
  assert.deepEqual(cleanDraft({ ...safe, customSections: [] }).appearance.sectionOrder, []);
});

test("block replies preserve fields and placeholders and reject private text without changing the vault", () => {
  const draft = cleanDraft({ terms: ["Private Org"] });
  const original = { title: "Project", body: "Built with [[PII_0001]] and [[PII_0001]]." };
  const reply = { ...original, title: "Prototype project" };
  assert.deepEqual(validateBlockReply(draft, original, "```json\n" + JSON.stringify(reply) + "\n```"), reply);
  assert.throws(() => validateBlockReply(draft, original, JSON.stringify({ ...reply, id: "custom-1" })), /exactly the fields/);
  assert.throws(() => validateBlockReply(draft, original, JSON.stringify({ ...reply, body: "[[PII_0001]]" })), /preserve every/);
  assert.throws(() => validateBlockReply(draft, original, JSON.stringify({ ...reply, title: "Private Org" })), /private text/);
  assert.deepEqual(draft.vault, {});
  assert.throws(() => validateBlockReply(draft, { reading: "C2" }, '{"reading":"expert"}'), /invalid value/);
});
