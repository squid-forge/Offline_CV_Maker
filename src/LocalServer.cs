using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

internal sealed class LocalServer : IDisposable
{
    internal const int Port = 8769;
    internal const string Host = "127.0.0.1:8769";
    internal const string Url = "http://" + Host;
    private static readonly Encoding Utf8 = new UTF8Encoding(false, true);
    private static readonly Dictionary<string, string[]> Assets = new Dictionary<string, string[]>
    {
        { "/", new[] { "index.html", "text/html" } },
        { "/styles.css", new[] { "styles.css", "text/css" } },
        { "/app.js", new[] { "app.js", "text/javascript" } },
        { "/privacy.mjs", new[] { "privacy.mjs", "text/javascript" } },
    };
    private readonly TcpListener listener = new TcpListener(IPAddress.Loopback, Port);
    private readonly SemaphoreSlim slots = new SemaphoreSlim(16);
    private readonly object gate = new object();
    private readonly Lazy<string> pairingToken = new Lazy<string>(LoadPairingToken);
    private Dictionary<string, object> request;
    private Dictionary<string, object> proposal;

    internal void Start()
    {
        listener.Server.ExclusiveAddressUse = true;
        listener.Start(16);
        var thread = new Thread(Accept) { IsBackground = true };
        thread.Start();
    }

    public void Dispose() { listener.Stop(); }

    private void Accept()
    {
        while (true)
        {
            TcpClient client;
            try { client = listener.AcceptTcpClient(); }
            catch (SocketException) { return; }
            catch (ObjectDisposedException) { return; }
            if (!slots.Wait(0)) { client.Close(); continue; }
            ThreadPool.QueueUserWorkItem(delegate
            {
                try { Handle(client); }
                catch (IOException) { }
                catch (SocketException) { }
                finally { client.Close(); slots.Release(); }
            });
        }
    }

    private static string ReadLine(Stream stream, ref int remaining)
    {
        var line = new StringBuilder();
        while (remaining-- > 0)
        {
            int value = stream.ReadByte();
            if (value < 0) throw new IOException("Request ended.");
            if (value == '\n') return line.ToString().TrimEnd('\r');
            line.Append((char)value);
        }
        throw new ArgumentException("Request headers are too large.");
    }

    private static string Header(Dictionary<string, string> headers, string key)
    {
        string value;
        return headers.TryGetValue(key, out value) ? value : "";
    }

    private void Handle(TcpClient client)
    {
        client.ReceiveTimeout = 3000;
        client.SendTimeout = 3000;
        using (var stream = client.GetStream())
        {
            bool head = false;
            try
            {
                int remaining = 8192;
                var line = ReadLine(stream, ref remaining).Split(' ');
                if (line.Length != 3) throw new ArgumentException("Invalid request.");
                string method = line[0], path = line[1];
                head = method == "HEAD";
                var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                string header;
                while ((header = ReadLine(stream, ref remaining)) != "")
                {
                    int colon = header.IndexOf(':');
                    if (colon < 1) throw new ArgumentException("Invalid header.");
                    var name = header.Substring(0, colon);
                    if (headers.ContainsKey(name)) throw new ArgumentException("Duplicate header.");
                    headers.Add(name, header.Substring(colon + 1).Trim());
                }
                if (Header(headers, "Host") != Host) { Error(stream, 403, "Use the local app address.", head); return; }
                string[] asset;
                if ((method == "GET" || head) && Assets.TryGetValue(path, out asset))
                {
                    using (var source = Assembly.GetExecutingAssembly().GetManifestResourceStream(asset[0]))
                    using (var buffer = new MemoryStream())
                    {
                        source.CopyTo(buffer);
                        Respond(stream, 200, asset[1], buffer.ToArray(), head);
                    }
                    return;
                }
                var origin = Header(headers, "Origin");
                if (path == "/mcp")
                {
                    HandleMcp(stream, method, headers, origin, head);
                    return;
                }
                if (!path.StartsWith("/api/", StringComparison.Ordinal)) { Error(stream, 404, "Not found.", head); return; }
                var role = Header(headers, "X-CV-Client");
                bool browser = role == "browser" && (origin == Url || method == "GET" && origin == "");
                bool agent = role == "stdio" && origin == "";
                if (!browser && !agent) { Error(stream, 403, "Only the local CV app and MCP bridge may use the exchange.", head); return; }
                if (path == "/api/exchange" && method == "GET")
                {
                    lock (gate) { Json(stream, Snapshot()); }
                    return;
                }
                if (agent && path == "/api/retrieve" && method == "GET")
                {
                    Json(stream, AgentExchange("retrieve", null));
                    return;
                }
                if (method != "POST" || Header(headers, "Transfer-Encoding") != "" ||
                    !Header(headers, "Content-Type").StartsWith("application/json", StringComparison.OrdinalIgnoreCase))
                {
                    Error(stream, 405, "Use a JSON POST.", head);
                    return;
                }
                var data = ReadBody(stream, headers);
                if (browser && path == "/api/connection")
                {
                    CvContract.Keys(data);
                    Json(stream, new { url = Url + "/mcp", token = pairingToken.Value, command = Assembly.GetExecutingAssembly().Location });
                    return;
                }
                Json(stream, UpdateExchange(path, data, browser, agent));
            }
            catch (ArgumentException error) { Error(stream, 400, error.Message, head); }
            catch (InvalidOperationException) { Error(stream, 400, "Invalid JSON request.", head); }
        }
    }


    private void HandleMcp(Stream stream, string method, Dictionary<string, string> headers, string origin, bool head)
    {
        if (origin != "" && origin != Url) { Error(stream, 403, "Untrusted MCP origin.", head); return; }
        if (!MatchesToken(Header(headers, "Authorization")))
        {
            Respond(stream, 401, "application/json", Utf8.GetBytes("{\"error\":\"Use the bearer token from Connect AI.\"}"), head,
                "WWW-Authenticate: Bearer realm=\"Local CV Maker\"\r\n");
            return;
        }
        if (method != "POST")
        {
            Respond(stream, 405, "application/json", Utf8.GetBytes("{\"error\":\"Use MCP JSON-RPC over POST.\"}"), head,
                "Allow: POST\r\n");
            return;
        }
        string version = Header(headers, "MCP-Protocol-Version");
        if (version != "" && !Mcp.Supports(version)) throw new ArgumentException("Unsupported MCP protocol version.");
        if (Header(headers, "Transfer-Encoding") != "" ||
            !Header(headers, "Content-Type").StartsWith("application/json", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Use a JSON POST with a Content-Length header.");
        var result = Mcp.Dispatch(ReadBody(stream, headers), AgentExchange);
        if (result == null) Respond(stream, 202, "application/json", new byte[0], false);
        else Json(stream, result);
    }

    private bool MatchesToken(string authorization)
    {
        if (!authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) || authorization.Length != 51) return false;
        string expected = pairingToken.Value;
        int difference = 0;
        for (int i = 0; i < expected.Length; i++) difference |= expected[i] ^ authorization[i + 7];
        return difference == 0;
    }

    private static string LoadPairingToken()
    {
        var bytes = new byte[32];
        using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);
        string token = Convert.ToBase64String(bytes);
        try
        {
            string profile = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (String.IsNullOrEmpty(profile)) return token;
            string folder = Path.Combine(profile, "Local CV Maker");
            Directory.CreateDirectory(folder);
            string file = Path.Combine(folder, "mcp-token");
            if (File.Exists(file))
            {
                string saved = File.ReadAllText(file);
                if (saved.Length == token.Length && Convert.FromBase64String(saved).Length == bytes.Length) return saved;
                return token;
            }
            using (var stream = new FileStream(file, FileMode.CreateNew))
            using (var writer = new StreamWriter(stream, Utf8)) writer.Write(token);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        catch (FormatException) { }
        catch (System.Security.SecurityException) { }
        return token;
    }

    private static Dictionary<string, object> ReadBody(Stream stream, Dictionary<string, string> headers)
    {
        int size;
        if (!Int32.TryParse(Header(headers, "Content-Length"), NumberStyles.None, CultureInfo.InvariantCulture, out size)
            || size <= 0 || size > CvContract.Limit) throw new ArgumentException("Request size is outside the limit.");
        var body = new byte[size];
        for (int offset = 0; offset < size;)
        {
            int read = stream.Read(body, offset, size - offset);
            if (read == 0) throw new IOException("Request ended.");
            offset += read;
        }
        return CvContract.Object(CvContract.Json().DeserializeObject(Utf8.GetString(body)));
    }

    private Dictionary<string, object> AgentExchange(string route, Dictionary<string, object> data)
    {
        if (route == "retrieve")
        {
            lock (gate)
            {
                if (request != null && !request.ContainsKey("retrieved"))
                {
                    request = new Dictionary<string, object>(request) { { "retrieved", true } };
                    Program.Log("An MCP client retrieved the active request.");
                }
                return Snapshot();
            }
        }
        return UpdateExchange("/api/" + route, data, false, true);
    }

    private Dictionary<string, object> UpdateExchange(string path, Dictionary<string, object> data, bool browser, bool agent)
    {
        lock (gate)
        {
            if (browser && (path == "/api/request" || path == "/api/block-request"))
            {
                bool block = path == "/api/block-request";
                string field = block ? "block" : "document";
                CvContract.Keys(data, "instruction", field, "previousId");
                if (data.ContainsKey("previousId") &&
                    (request == null ? null : (string)request["id"]) != CvContract.Get(data, "previousId") as string)
                    throw new ArgumentException("The live request changed. Review it before queueing another one.");
                request = new Dictionary<string, object>
                {
                    { "id", Guid.NewGuid().ToString("N") },
                    { "instruction", CvContract.Instruction(CvContract.Get(data, "instruction")) },
                    { field, block ? CvContract.Block(CvContract.Get(data, field)) : CvContract.Document(CvContract.Get(data, field)) },
                };
                if (block) request["kind"] = "block";
                proposal = null;
                Program.Log(block ? "Queued a block request." : "Queued a full-CV request.");
            }
            else if (browser && path == "/api/clear")
            {
                CvContract.Keys(data, "id");
                RequireCurrent(data);
                request = null;
                proposal = null;
                Program.Log("Cleared the active request.");
            }
            else if (agent && path == "/api/revise-block")
            {
                RequireCurrent(data);
                if (proposal != null) throw new ArgumentException("A proposal is already waiting for review.");
                if (!request.ContainsKey("block")) throw new ArgumentException("The current request is for the full CV.");
                CvContract.Keys(data, "id", "block", "note");
                proposal = new Dictionary<string, object>
                {
                    { "block", CvContract.Block(CvContract.Get(data, "block"), CvContract.Object(request["block"])) },
                    { "note", CvContract.Note(CvContract.Get(data, "note")) },
                    { "kind", "block" },
                };
                Program.Log("Received a block proposal for review.");
            }
            else if (agent && (path == "/api/revise" || path == "/api/restyle"))
            {
                RequireCurrent(data);
                if (proposal != null) throw new ArgumentException("A proposal is already waiting for review.");
                if (!request.ContainsKey("document")) throw new ArgumentException("Use submit_cv_block to respond to the current block request.");
                var original = CvContract.Object(request["document"]);
                Dictionary<string, object> updated;
                bool styling = path == "/api/restyle";
                if (styling)
                {
                    CvContract.Keys(data, "id", "appearance", "note");
                    var style = new Dictionary<string, object>(CvContract.Object(original["appearance"]));
                    var patch = CvContract.Style(CvContract.Get(data, "appearance"), true);
                    if (patch.Count == 0) throw new ArgumentException("Provide at least one style change.");
                    foreach (var entry in patch) style[entry.Key] = entry.Value;
                    updated = new Dictionary<string, object>(original);
                    updated["appearance"] = style;
                    CvContract.Document(updated);
                }
                else
                {
                    CvContract.Keys(data, "id", "document", "note");
                    updated = CvContract.Document(CvContract.Get(data, "document"));
                    CvContract.RequireSamePlaceholders(original, updated);
                }
                proposal = new Dictionary<string, object>
                {
                    { "document", updated },
                    { "note", CvContract.Note(CvContract.Get(data, "note")) },
                    { "kind", styling ? "style" : "revision" },
                };
                Program.Log("Received a full-CV proposal for review.");
            }
            else throw new ArgumentException("This action is unavailable for that client.");
            return Snapshot();
        }
    }

    private void RequireCurrent(Dictionary<string, object> data)
    {
        if (request == null || (string)request["id"] != (CvContract.Get(data, "id") as string))
            throw new ArgumentException("This request is no longer active. Get the current CV request.");
    }

    private Dictionary<string, object> Snapshot() { return new Dictionary<string, object> { { "request", request }, { "proposal", proposal } }; }

    private static void Json(Stream stream, object payload)
    {
        Respond(stream, 200, "application/json", Utf8.GetBytes(CvContract.Json().Serialize(payload)), false);
    }

    private static void Error(Stream stream, int status, string error, bool head)
    {
        Respond(stream, status, "application/json", Utf8.GetBytes(CvContract.Json().Serialize(new { error })), head);
    }

    private static void Respond(Stream stream, int status, string media, byte[] payload, bool head, string extraHeaders = "")
    {
        var reason = status == 200 ? "OK" : status == 202 ? "Accepted" : status == 401 ? "Unauthorized" : status == 403 ? "Forbidden" : status == 404 ? "Not Found" :
            status == 405 ? "Method Not Allowed" : "Bad Request";
        var headers = "HTTP/1.1 " + status + " " + reason + "\r\nConnection: close\r\n" +
            "Content-Type: " + media + "; charset=utf-8\r\nContent-Length: " + payload.Length + "\r\n" +
            "Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Local-CV-Maker: 3\r\n" +
            "Referrer-Policy: no-referrer\r\n" + extraHeaders +
            "Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; " +
            "img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'\r\n\r\n";
        var data = Encoding.ASCII.GetBytes(headers);
        stream.Write(data, 0, data.Length);
        if (!head) stream.Write(payload, 0, payload.Length);
    }
}
