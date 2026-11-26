using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;

internal static class Mcp
{
    private static readonly Encoding Utf8 = new UTF8Encoding(false);
    private static readonly string[] Protocols = { "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05" };
    private const string ProcessPrompt = "process_cv_request";
    private const string AgentInstructions = "Call get_cv_request first. Follow the user's queued instruction and preserve facts and every private placeholder exactly, including repeated occurrences. For kind=block, edit only the returned block and call submit_cv_block with the request ID and the same block fields. For a full CV, use restyle_cv or submit_cv_revision. The user reviews the proposal in the app.";

    internal static void Run()
    {
        using (var input = new StreamReader(Console.OpenStandardInput(), Utf8))
        using (var output = new StreamWriter(Console.OpenStandardOutput(), Utf8) { AutoFlush = true })
        {
            string line;
            while ((line = input.ReadLine()) != null)
            {
                if (String.IsNullOrWhiteSpace(line)) continue;
                if (line.Length > CvContract.Limit)
                {
                    Write(output, Error(null, -32600, "Request is too large."));
                    continue;
                }
                Dictionary<string, object> request;
                try { request = CvContract.Object(CvContract.Json().DeserializeObject(line)); }
                catch (ArgumentException) { Write(output, Error(null, -32700, "Invalid JSON-RPC request.")); continue; }
                catch (InvalidOperationException) { Write(output, Error(null, -32700, "Invalid JSON-RPC request.")); continue; }
                var response = Dispatch(request, Exchange);
                if (response != null) Write(output, response);
            }
        }
    }

    internal static bool Supports(string protocol) { return Protocols.Contains(protocol); }

    internal static object Dispatch(Dictionary<string, object> request,
        Func<string, Dictionary<string, object>, Dictionary<string, object>> exchange)
    {
        var id = CvContract.Get(request, "id");
        var method = CvContract.Get(request, "method") as string;
        if ((CvContract.Get(request, "jsonrpc") as string) != "2.0" || String.IsNullOrEmpty(method))
            return Error(id, -32600, "Invalid JSON-RPC request.");
        if (!request.ContainsKey("id")) return null;
        var parameters = CvContract.Get(request, "params") as Dictionary<string, object> ??
            new Dictionary<string, object>();
        if (method == "initialize")
        {
            var proposed = CvContract.Get(parameters, "protocolVersion") as string;
            return Result(id, new
            {
                protocolVersion = Supports(proposed) ? proposed : Protocols[0],
                capabilities = new { tools = new { listChanged = false }, prompts = new { listChanged = false } },
                serverInfo = new { name = "local-cv-maker", version = "0.2.0" },
                instructions = AgentInstructions,
            });
        }
        if (method == "ping") return Result(id, new { });
        if (method == "tools/list") return Result(id, new { tools = Tools() });
        if (method == "prompts/list") return Result(id, new { prompts = new[] {
            new { name = ProcessPrompt, title = "Process Local CV Maker request", description = "Retrieve the redacted request and send a proposal back to Local CV Maker." }
        } });
        if (method == "prompts/get")
        {
            if ((CvContract.Get(parameters, "name") as string) != ProcessPrompt) return Error(id, -32602, "Unknown prompt.");
            return Result(id, new { messages = new[] { new { role = "user",
                content = new { type = "text", text = "Process my queued Local CV Maker request using the app's MCP tools. " + AgentInstructions }
            } } });
        }
        if (method == "tools/call")
        {
            var name = CvContract.Get(parameters, "name") as string;
            var args = CvContract.Get(parameters, "arguments") as Dictionary<string, object> ??
                new Dictionary<string, object>();
            return Result(id, Call(name, args, exchange));
        }
        return Error(id, -32601, "Method not found.");
    }
    private static object Call(string name, Dictionary<string, object> args, Func<string, Dictionary<string, object>, Dictionary<string, object>> exchange)
    {
        try
        {
            if (name == "get_cv_request")
            {
                CvContract.Keys(args);
                var snapshot = exchange("retrieve", null);
                var request = CvContract.Get(snapshot, "request");
                return ToolResult(request ?? new { status = "no_request", message = "Queue a request in Ask AI or the Agent tab." });
            }
            if (name == "restyle_cv" || name == "submit_cv_revision" || name == "submit_cv_block")
            {
                exchange(name == "restyle_cv" ? "restyle" : name == "submit_cv_block" ? "revise-block" : "revise", args);
                return ToolResult(new { status = "ready_for_review" });
            }
            return ToolError("Unknown tool.");
        }
        catch (ArgumentException error) { return ToolError(error.Message); }
        catch (WebException error)
        {
            if (error.Response != null)
            {
                try
                {
                    using (error.Response)
                    using (var stream = error.Response.GetResponseStream())
                    using (var reader = new StreamReader(stream, Utf8))
                    {
                        var payload = CvContract.Object(CvContract.Json().DeserializeObject(reader.ReadToEnd()));
                        return ToolError(CvContract.Get(payload, "error") as string ?? "The app refused the proposal.");
                    }
                }
                catch (Exception) { return ToolError("The local CV app refused the request."); }
            }
            return ToolError("Open Local CV Maker on this computer and queue a request in Ask AI or the Agent tab.");
        }
        catch (IOException) { return ToolError("Could not contact the local CV app."); }
        catch (InvalidOperationException) { return ToolError("Invalid reply from the local CV app."); }
    }

    private static Dictionary<string, object> Exchange(string route, Dictionary<string, object> body)
    {
        var request = (HttpWebRequest)WebRequest.Create(LocalServer.Url + "/api/" + route);
        request.Proxy = null;
        request.AllowAutoRedirect = false;
        request.KeepAlive = false;
        request.Timeout = 4000;
        request.ReadWriteTimeout = 4000;
        request.ServicePoint.Expect100Continue = false;
        request.Headers.Add("X-CV-Client", "stdio");
        if (body != null)
        {
            var bytes = Utf8.GetBytes(CvContract.Json().Serialize(body));
            request.Method = "POST";
            request.ContentType = "application/json";
            request.ContentLength = bytes.Length;
            using (var output = request.GetRequestStream()) output.Write(bytes, 0, bytes.Length);
        }
        using (var response = request.GetResponse())
        {
            if (response.Headers["X-Local-CV-Maker"] != "3") throw new ArgumentException("The local port belongs to another app.");
            using (var reader = new StreamReader(response.GetResponseStream(), Utf8))
            {
                return CvContract.Object(CvContract.Json().DeserializeObject(reader.ReadToEnd()));
            }
        }
    }

    private static object[] Tools()
    {
        var style = new Dictionary<string, object>
        {
            { "accent", new { type = "string", pattern = "^#[0-9a-fA-F]{6}$", description = "Heading and divider color." } },
            { "textColor", new { type = "string", pattern = "^#[0-9a-fA-F]{6}$", description = "Body text color." } },
            { "font", Enum("sans", "serif", "humanist") },
            { "density", Enum("balanced", "compact", "spacious") },
            { "photoPosition", Enum("left", "right") },
            { "headerAlignment", Enum("left", "center") },
            { "rules", Enum("thin", "none", "heavy") },
            { "fontSize", new { type = "number", minimum = 9, maximum = 13, description = "Body type size in points." } },
            { "spacing", new { type = "number", minimum = .7, maximum = 1.5, description = "Multiplier for paragraph and bullet line spacing." } },
            { "margin", new { type = "number", minimum = 10, maximum = 22, description = "Page content inset in millimeters." } },
            { "sectionOrder", new
                {
                    type = "array",
                    items = new { anyOf = new object[] { Enum(CvContract.Sections.Concat(new[] { "headline" }).ToArray()),
                        new { type = "string", pattern = CvContract.CustomSectionPattern } } },
                    uniqueItems = true, maxItems = CvContract.Sections.Length + 1 + CvContract.MaxCustomSections,
                    description = "Empty for default, or all six standard keys with optional headline and existing custom section IDs. Omitted headline appears first and omitted custom sections appear at the end.",
                }
            },
        };
        var entry = new Dictionary<string, object>();
        foreach (var key in new[] { "title", "organisation", "dates", "description" }) entry.Add(key, new { type = "string" });
        var lang = new Dictionary<string, object> { { "title", new { type = "string" } } };
        foreach (var key in new[] { "listening", "reading", "production", "interaction", "writing" }) lang.Add(key, Enum(CvContract.Levels));
        var doc = new Dictionary<string, object>();
        foreach (var key in CvContract.TextFields) doc.Add(key, new { type = "string" });
        foreach (var key in CvContract.Groups)
        {
            var row = key == "languages" ? lang : entry;
            doc.Add(key, new { type = "array", maxItems = 50, items = Schema(row, row.Keys.ToArray()) });
        }
        doc.Add("layout", Enum("technical", "experience"));
        doc.Add("appearance", Schema(style, style.Keys.ToArray()));
        var requiredDocFields = doc.Keys.ToArray();
        var customSection = new Dictionary<string, object>
        {
            { "id", new { type = "string", pattern = CvContract.CustomSectionPattern } },
            { "title", new { type = "string", maxLength = 250 } },
            { "body", new { type = "string", maxLength = 4000 } },
        };
        doc.Add("customSections", new { type = "array", maxItems = CvContract.MaxCustomSections,
            items = Schema(customSection, customSection.Keys.ToArray()) });
        var block = CvContract.BlockFields.ToDictionary(key => key, key => CvContract.LevelFields.Contains(key)
            ? Enum(CvContract.Levels) : (object)new { type = "string" });

        return new object[]
        {
            new { name = "get_cv_request", description = "Read the user's queued instruction and either the selected redacted block (kind=block) or a redacted full CV.", inputSchema = Schema(new Dictionary<string, object>()), annotations = new { readOnlyHint = true, openWorldHint = false } },
            new { name = "submit_cv_block", description = "Send a proposed revision for the current block request. Return exactly the block's original field names and preserve all private placeholders exactly, including repeated occurrences. The user reviews and applies the proposal.", inputSchema = Schema(ProposalFields("block", Schema(block)), "id", "block"), annotations = new { destructiveHint = false, openWorldHint = false } },
            new { name = "restyle_cv", description = "Propose specific style changes to the current redacted CV while preserving its text. Provide any subset of appearance fields. The app previews the proposal for user review.", inputSchema = Schema(ProposalFields("appearance", Schema(style)), "id", "appearance"), annotations = new { destructiveHint = false, openWorldHint = false } },
            new { name = "submit_cv_revision", description = "Propose a full revised redacted document, optionally including style changes. Keep every [[PII_0000]]-shaped placeholder exactly as provided. Preserve facts and include existing custom sections unless asked to change them. The user reviews and applies the proposal.", inputSchema = Schema(ProposalFields("document", Schema(doc, requiredDocFields)), "id", "document"), annotations = new { destructiveHint = false, openWorldHint = false } },
        };
    }

    private static Dictionary<string, object> ProposalFields(string name, object schema)
    {
        return new Dictionary<string, object>
        {
            { "id", new { type = "string", description = "The active request ID returned by get_cv_request." } },
            { name, schema },
            { "note", new { type = "string", maxLength = 1000, description = "Optional summary for the user." } }
        };
    }

    private static object Enum(params string[] values) { return new { type = "string", @enum = values }; }
    private static object Schema(Dictionary<string, object> properties, params string[] required)
    {
        return new { type = "object", properties, required, additionalProperties = false };
    }

    private static object ToolResult(object data)
    {
        return new { content = new[] { new { type = "text", text = CvContract.Json().Serialize(data) } }, structuredContent = data };
    }
    private static object ToolError(string detail) { return new { content = new[] { new { type = "text", text = detail } }, isError = true }; }
    private static object Result(object id, object result) { return new { jsonrpc = "2.0", id, result }; }
    private static object Error(object id, int code, string message) { return new { jsonrpc = "2.0", id, error = new { code, message } }; }
    private static void Write(TextWriter output, object value) { output.WriteLine(CvContract.Json().Serialize(value)); }
}
