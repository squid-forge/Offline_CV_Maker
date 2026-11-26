# Local CV Maker

An AI-compatible CV maker for Windows with a separate **Personal** section. Build, preview, and export your CV completely offline, or connect a compatible MCP agent for optional editing help. The app opens a local editor in your browser.

## Run

Double-click **Local CV Maker.exe** on Windows 10 or 11. The app opens the local editor in your browser at `http://127.0.0.1:8769/` and a small **Activity** window. Activity shows startup and request status. **Hide** or close it to keep using the editor. The system tray menu can reopen the editor or Activity and quit the app.

If you downloaded the source or prefer to compile your own executable, see [Build from source](#build-from-source).

1. Enter your name, contact details, and an optional photo under **Personal**. Open **Sections** to edit your headline, profile, education, projects, work, skills, and languages. The redacted preview uses A4 proportions and appears below the editor on narrow screens.
2. Use **Add section** for certifications, volunteering, or other custom sections. Use the **↑** and **↓** buttons beside sections and entries to change their order in the preview and PDF.
3. Highlight sensitive words in a description and choose **Mark selected text as private**. You can also enter phrases directly in **Personal**. Known values become numbered placeholders. **CV style** controls the preview and PDF. **App theme** changes the editor colors and remembers your choice in this browser.
4. Choose **Export full PDF**, select **Save as PDF** in your browser and turn off browser headers and footers. The app restores known personal values in the print document only. The regular browser print command prints the redacted preview.

Use **File → Save redacted backup** to make a portable copy of the text and styling with placeholders. A full backup is available under **Personal** and contains unencrypted personal information. Browser drafts remain in the current browser profile until replaced or cleared.

## Connect an AI agent

Open the editor from the Windows app or tray, then use **Connect AI** to choose a transport. If you used HTTP with an older build, replace the saved pairing token with the one shown in **Connect AI**.

- **Streamable HTTP** uses `http://127.0.0.1:8769/mcp` and the displayed bearer token. Use a local client with support for a custom Authorization header. Keep the token private.
- **stdio** uses the absolute executable path and the `--mcp` argument. Run the client on the same computer and under the same Windows account as the app. For clients with an `mcpServers` configuration, add the displayed command and arguments under a server named `local-cv-maker`.

The localhost address is reachable from the computer running the app. A hosted agent needs a client or bridge that runs locally and can reach that address.

1. In **Sections**, open a block or entry and choose **Ask AI**, or open **Agent** for whole-CV changes. Enter an instruction and review the exact redacted request before sharing it.
2. In your MCP client, run **Process Local CV Maker request**, or ask the agent to process the pending request with the Local CV Maker tools. The client retrieves the redacted data and submits its proposal through MCP.
3. Review the proposal in the app and apply it when ready. **Review replacement** offers to supersede the active request. **Send after current** prepares a block follow-up for your approval after you apply or discard the current proposal. **Cancel request** closes that request in CV Maker and rejects late replies. Use the agent client’s stop control to end its own model run.

| MCP tool | Purpose |
| --- | --- |
| `get_cv_request` | Retrieve the request ID, instruction, and redacted block or document. |
| `submit_cv_block` | Propose changes to the selected block while preserving its fields and placeholders. |
| `restyle_cv` | Propose any subset of the appearance settings without changing the content. |
| `submit_cv_revision` | Propose a new document, including optional style changes, while preserving every placeholder. |

For example, ask the agent to “Use a warm navy accent, a serif font, a centered header, and tighter spacing. Move projects before work experience.” The preview and PDF use the same validated styling controls. The MCP tools accept structured design settings.

## Privacy

The app makes no external requests. The local service authenticates the editor and agent connections and keeps queued CV data in memory. The Personal section, photo, and original values behind placeholders stay in the browser profile. Full export substitutes those values in a temporary print-only document.

Masking covers exact personal-field values, declared words and phrases, common email and phone formats, and web links. Free text can still contain identifying details such as initials or named locations. Review the request before sharing and mark any remaining details as private. A connected online agent may send the approved text to its model provider. Keep the browser profile and full backups outside any files or browser sessions you give an agent access to. Use the app offline when no CV text should reach an external service.

## Build from source

1. Clone the repository or use **Code → Download ZIP** on GitHub and extract the files.
2. Quit any running instance from the system tray. Open Command Prompt in the extracted folder and run `build.cmd`.
3. Open the resulting **Local CV Maker.exe** in the same folder.

The build uses the Windows .NET Framework C# compiler and needs no package downloads. This option compiles the reviewed source on your own computer. The resulting executable is unsigned, and Windows security policies still apply.

For build automation, PowerShell supports `./build.ps1 -OutputPath 'C:/path/Local CV Maker.exe'`.

## Tests

```text
node --test ./tests/privacy.test.mjs
```

To exercise both MCP transports, start the build with `--serve` in an isolated test session, set `CV_TEST_URL` to `http://127.0.0.1:8769` and `CV_TEST_EXE` to the executable path, and run `node --test ./tests/mcp.test.mjs` from the same Windows account.

MIT licensed. See [LICENSE](LICENSE).
