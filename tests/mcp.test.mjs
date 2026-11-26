import { strict as assert } from "node:assert";
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { agentDocument, cleanDraft } from "../dist/privacy.mjs";

const url = process.env.CV_TEST_URL;
const exe = process.env.CV_TEST_EXE;

function browserToken() {
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `
    $ErrorActionPreference = 'Stop'
    Add-Type -AssemblyName System.Security
    $path = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Local CV Maker/local-access.dat'
    $key = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($path), $null, 'CurrentUser')
    $hmac = New-Object Security.Cryptography.HMACSHA256 -ArgumentList (,$key)
    try { [Convert]::ToBase64String($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes('browser'))).TrimEnd('=').Replace('+','-').Replace('/','_') } finally { $hmac.Dispose() }
  `], { encoding: "utf8", windowsHide: true }).trim();
}

test("both MCP transports handle scoped revisions, replacement, and cancellation", { skip: !url || !exe, timeout: 12000 }, async () => {
  assert.match(url, /^http:\/\/127\.0\.0\.1:[0-9]+$/, "Use a loopback-only test server.");
  const token = browserToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const process = spawn(exe, ["--mcp"], { windowsHide: true, stdio: ["pipe", "pipe", "inherit"] });
  const replies = createInterface({ input: process.stdout })[Symbol.asyncIterator]();
  const headers = { "X-CV-Client": "browser", "Content-Type": "application/json", Origin: url, Authorization: "Bearer " + token };
  const post = (path, data, overrides) => fetch(url + "/api/" + path, { method: "POST", headers: { ...headers, ...overrides }, body: JSON.stringify(data) });
  let rpcId = 0;
  const envelope = (method, params) => ({ jsonrpc: "2.0", id: ++rpcId, method, params });
  const call = (name, args = {}) => ({ name, arguments: args });
  let activeId;
  try {
    const settings = await post("connection", {});
    assert.equal(settings.status, 200);
    const { url: mcpUrl, token: mcpToken } = await settings.json();
    assert.equal(mcpUrl, url + "/mcp");
    const rpc = (message, options = {}) => fetch(mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", Accept: "application/json, text/event-stream",
        Authorization: "Bearer " + mcpToken, ...options,
      },
      body: JSON.stringify(message),
    });
    const httpTool = async (name, args) => {
      const response = await rpc(envelope("tools/call", call(name, args)));
      assert.equal(response.status, 200);
      return (await response.json()).result;
    };
    assert.equal((await rpc(envelope("tools/list"), { Authorization: "Bearer incorrect" })).status, 401);
    assert.equal((await rpc(envelope("tools/list"), { Authorization: "Bearer " + token })).status, 401);
    assert.equal((await rpc(envelope("tools/list"), { Origin: "https://example.invalid" })).status, 403);
    const init = await rpc(envelope("initialize", { protocolVersion: "2025-11-25" }));
    assert.equal((await init.json()).result.protocolVersion, "2025-11-25");
    assert.equal((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);

    const block = { title: "Volunteering", body: "Helped [[PII_0001]] organize a workshop." };
    const queue = async previousId => {
      const response = await post("block-request", { instruction: "Improve the wording.", block, previousId });
      assert.equal(response.status, 200);
      return (await response.json()).request.id;
    };
    activeId = await queue(null);
    assert.equal((await post("connection", {}, { Authorization: "" })).status, 401);
    assert.equal((await post("clear", { id: activeId }, { Authorization: "" })).status, 401);
    assert.equal((await fetch(url + "/api/exchange", { headers: { "X-CV-Client": "browser" } })).status, 401);
    assert.equal((await fetch(url + "/api/retrieve", { headers: {
      "X-CV-Client": "stdio", Authorization: "Bearer " + mcpToken,
    } })).status, 401);
    assert.equal((await post("connection", {}, { Origin: "https://example.invalid" })).status, 403);
    const request = (await httpTool("get_cv_request")).structuredContent;
    assert.equal(request.id, activeId);
    assert.equal(request.kind, "block");
    assert.deepEqual(request.block, block);
    assert.equal(Object.hasOwn(request, "document"), false);
    const oldId = activeId;
    activeId = await queue(oldId);
    assert.equal((await httpTool("submit_cv_block", { id: oldId, block })).isError, true);
    assert.equal((await httpTool("submit_cv_block", { id: activeId, block: { ...block, body: "Missing placeholder." } })).isError, true);

    const stdioMessage = envelope("tools/call", call("submit_cv_block", { id: activeId, block }));
    process.stdin.write(JSON.stringify(stdioMessage) + "\n");
    const { value } = await replies.next();
    assert.equal(JSON.parse(value).result.structuredContent.status, "ready_for_review");
    const cleared = await post("clear", { id: activeId });
    assert.equal((await cleared.json()).proposal, null);
    assert.equal((await httpTool("submit_cv_block", { id: activeId, block })).isError, true);
    activeId = undefined;
    const draft = cleanDraft({
      personal: { name: "Ann", phone: "(202) 555-0199", email: "fictional@example.invalid", photo: "data:image/jpeg;base64,AAAA" },
      about: "Ann ".repeat(1000),
      work: [{ description: "Contact (202) 555-0199 or https://example.invalid/ann." }],
    });
    const document = agentDocument(draft);
    assert.equal((await post("request", { instruction: "Call (202) 555-0199.", document, previousId: null })).status, 400);
    assert.equal((await post("request", {
      instruction: "Improve CV", document: { ...document, personal: draft.personal }, previousId: null,
    })).status, 400);
    const full = await post("request", { instruction: "Improve CV", document, previousId: null });
    assert.equal(full.status, 200);
    activeId = (await full.json()).request.id;
    const payload = (await httpTool("get_cv_request")).structuredContent;
    assert.deepEqual(payload.document, document);
    assert.doesNotMatch(JSON.stringify(payload), /\bAnn\b|555-0199|example\.invalid|data:image|"personal"|"vault"|"photo"/);
  } finally {
    if (activeId) await post("clear", { id: activeId });
    process.stdin.end();
  }
});
