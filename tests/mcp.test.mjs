import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { test } from "node:test";

const url = process.env.CV_TEST_URL;
const exe = process.env.CV_TEST_EXE;

test("both MCP transports handle scoped revisions, replacement, and cancellation", { skip: !url || !exe, timeout: 12000 }, async () => {
  const process = spawn(exe, ["--mcp"], { windowsHide: true, stdio: ["pipe", "pipe", "inherit"] });
  const replies = createInterface({ input: process.stdout })[Symbol.asyncIterator]();
  const headers = { "X-CV-Client": "browser", "Content-Type": "application/json", Origin: url };
  const post = (path, data) => fetch(url + "/api/" + path, { method: "POST", headers, body: JSON.stringify(data) });
  let rpcId = 0;
  const envelope = (method, params) => ({ jsonrpc: "2.0", id: ++rpcId, method, params });
  const call = (name, args = {}) => ({ name, arguments: args });
  let activeId;
  try {
    const settings = await post("connection", {});
    assert.equal(settings.status, 200);
    const { url: mcpUrl, token } = await settings.json();
    assert.equal(mcpUrl, url + "/mcp");
    const rpc = (message, options = {}) => fetch(mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", Accept: "application/json, text/event-stream",
        Authorization: "Bearer " + token, ...options,
      },
      body: JSON.stringify(message),
    });
    const httpTool = async (name, args) => {
      const response = await rpc(envelope("tools/call", call(name, args)));
      assert.equal(response.status, 200);
      return (await response.json()).result;
    };
    assert.equal((await rpc(envelope("tools/list"), { Authorization: "Bearer incorrect" })).status, 401);
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
  } finally {
    if (activeId) await post("clear", { id: activeId });
    process.stdin.end();
  }
});
