# Local CV Maker

An AI-compatible CV maker for Windows with a separate **Personal** section. Build, preview, and export your CV completely offline, or connect a compatible MCP agent for optional editing help. The app opens a local editor in your browser.

## Run

Double-click **Local CV Maker.exe** on Windows 10 or 11. The app opens a log console and the local editor in your default browser at `http://127.0.0.1:8769/`. The console reports startup and request status without displaying CV content or the pairing token. Use **Open CV Maker** in the system tray to reopen the editor and **Quit** to close the app.

1. Enter your name, contact details, and an optional photo under **Personal**. Open **Sections** to edit your headline, profile, education, projects, work, skills, and languages. The redacted preview appears beside the editor on wider screens.
2. Add or reorder entries within their sections. Use **Add custom section** for sections such as certifications or volunteering. Use **Move section up** and **Move section down** to change the order in the preview and PDF.
3. Highlight sensitive words in a description and choose **Mark selected text as private**. You can also enter phrases directly in **Personal**. Known values become numbered placeholders. In **Themes**, choose a preset or adjust the appearance while watching the live preview.
4. Choose **Export full PDF**, select **Save as PDF** in your browser and turn off browser headers and footers. The app restores known personal values in the print document only. The regular browser print command prints the redacted preview.

Use **Save redacted backup** to make a portable copy of the text and styling with placeholders. A full backup is available under **Personal** and contains unencrypted personal information. Browser drafts remain in the current browser profile until replaced or cleared.

## Connect an AI agent

Open **Connect AI** and choose the transport your client supports. Add the displayed settings once in your client.

- **Streamable HTTP** uses `http://127.0.0.1:8769/mcp` and the displayed bearer token. Use a local client with support for a custom Authorization header. Keep the token private.
- **stdio** uses the absolute executable path and the `--mcp` argument. Run the client on the same computer as the CV app. For clients with an `mcpServers` configuration, add the displayed command and arguments under a server named `local-cv-maker`.

The localhost address is reachable from the computer running the app. A hosted agent needs a client or bridge that runs locally and can reach that address.

1. In **Sections**, open a block or entry and choose **Ask AI**. Enter an instruction, review what will be shared, and choose **Send via MCP**. For whole-CV changes, use **Agent**.
2. In your MCP client, run **Process Local CV Maker request**, or ask the agent to process the pending request with the Local CV Maker tools. The client retrieves the redacted data and submits its proposal through MCP.
3. Review the proposal in the app and apply it when ready. **Replace now** supersedes the active request. **Send after current** queues a block follow-up after you apply or discard the current proposal. **Cancel request** closes that request in CV Maker and rejects late replies. Use the agent client’s stop control to end its own model run.

| MCP tool | Purpose |
| --- | --- |
| `get_cv_request` | Retrieve the request ID, instruction, and redacted block or document. |
| `submit_cv_block` | Propose changes to the selected block while preserving its fields and placeholders. |
| `restyle_cv` | Propose any subset of the appearance settings without changing the content. |
| `submit_cv_revision` | Propose a new document, including optional style changes, while preserving every placeholder. |

For example, ask the agent to “Use a warm navy accent, a serif font, a centered header, and tighter spacing. Move projects before work experience.” The preview and PDF use the same validated styling controls. The MCP tools accept structured design settings.

## Privacy

The app makes no external requests. Queued CV data and proposals stay in the local service’s memory. The browser keeps your personal fields, photo, and the original values behind placeholders. Full export substitutes those values in a temporary print-only document.

Masking covers exact personal-field values, declared words and phrases, and recognizable email addresses. Check the redacted CV and request before sharing, and mark variants like initials, shortened employer names, or alternate phone formats separately. A connected online agent may send the redacted content it retrieves to its model provider. For CV work, use the MCP tools and keep the app's browser profile and full backups out of folders or browser sessions you give an agent direct access to.

## Build and test

Run from a checkout on Windows with the .NET Framework C# compiler:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./build.ps1
node --test ./tests/privacy.test.mjs
```

The build embeds the web UI in a single executable with no dependency downloads. To exercise both MCP transports, start the build with `--serve` in an isolated test session, set `CV_TEST_URL` to `http://127.0.0.1:8769` and `CV_TEST_EXE` to the executable path, and run `node --test ./tests/mcp.test.mjs`.

MIT licensed. See [LICENSE](LICENSE).
