# Connect Kaschuso to your chatbot

Use the same remote MCP endpoint with a separate school-account connection in each compatible chatbot:

`https://kaschuso-api.onrender.com/mcp`

Authentication: OAuth authorization code with S256 PKCE. Read scope: `grades:read`. Dynamic client registration is available; you normally do not need a client ID or client secret. Keep TLS verification enabled. School sign-in and explicit read-only consent happen on the Kaschuso dashboard. Never paste a school password, browser cookie or access token into a chat, URL or configuration file.

## ChatGPT web

1. Open [Plugins](https://chatgpt.com/plugins).
2. Select **+ → Add custom MCP server**.
3. Enter a name, the endpoint above, and OAuth authentication. Use automatic client registration where offered.
4. Review the connection and select **Create as a plugin**. Complete school sign-in and consent.
5. Check the discovered tools, select the connected plugin in a new chat, and ask for your grade overview.

An uploaded interpretation skill alone does not connect a server. A private custom connection need not appear in public plugin search. After a server update, open its connection and use **Refresh** to discover new tools and instructions.

[Official setup guide](https://developers.openai.com/plugins/deploy/connect-chatgpt)

## Claude web and Desktop remote connectors

Open **Customize → Connectors → Add custom connector**, enter the endpoint, and complete the detected OAuth sign-in. Each student authorizes their own account. Remote connectors use Anthropic's cloud connection; local stdio-only configurations are a different setup.

[Official Claude guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

For Claude Code, use the current CLI's HTTP MCP setup, for example:

```sh
claude mcp add --transport http kaschuso https://kaschuso-api.onrender.com/mcp
```

Then use Claude Code's MCP authentication action. Native clients must register their actual loopback callback as a native OAuth client; unrelated HTTP callbacks are rejected.

## Codex

```sh
codex mcp add kaschuso --url https://kaschuso-api.onrender.com/mcp
codex mcp login kaschuso
```

[Official MCP guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

## Other MCP clients

Use a client supporting remote Streamable HTTP and per-user OAuth. The portable connection configuration is:

```json
{
  "mcpServers": {
    "kaschuso": {
      "type": "streamable-http",
      "url": "https://kaschuso-api.onrender.com/mcp"
    }
  }
}
```

Configuration keys differ by client: [Gemini CLI](https://geminicli.com/docs/tools/mcp-server/) uses `httpUrl` for Streamable HTTP and `/mcp auth kaschuso`; [VS Code/Copilot Chat](https://docs.github.com/en/copilot/how-tos/copilot-in-your-ide/customize-copilot/extend-copilot-with-tools-and-context/extend-copilot-chat-with-mcp?tool=vscode) has its own MCP configuration and authentication action. Consumer Gemini web, Microsoft 365 Copilot and Copilot cloud agents do not necessarily support the same OAuth MCP workflow. Client plans, versions and workspace policies can limit custom connections. ChatGPT web is the live-tested priority; other clients have protocol compatibility coverage, not a claimed live account test.

## Instructions to give a setup-capable assistant

> Set up the remote Kaschuso MCP connection at https://kaschuso-api.onrender.com/mcp in this client using Streamable HTTP, OAuth discovery, S256 PKCE and scope grades:read. Use automatic client registration if supported. Keep any tokens in the client's supported secret store. Open the normal OAuth connection flow and let me complete school sign-in and consent myself. Do not ask for school credentials in chat. Verify the discovered tools after connection. Begin with get_grade_overview; use get_grade_history for old semesters and get_qualification_overview or calculate_qualification_scenario for separate BM/BFS averages and target planning. Explain incomplete/provisional results and source-specific rules. Do not use public plugin dependency lookup for this private connection or claim installation/authentication succeeded until verified.

The assistant can prepare supported client configuration, but Markdown cannot install a plugin, bypass client policy or grant consent on a student's behalf.

## Available read-only tools

- `get_grade_overview`: current subject averages and assessment counts.
- `get_subject_grades`: paginated assessment details using returned subject references.
- `get_unconfirmed_grades`: the separate awaiting-confirmation feed.
- `calculate_grade_projection`: a next-assessment estimate with an explicit next weight.
- `get_grade_history`: authorised previous school semesters.
- `get_qualification_overview`: separate BM/BFS semester averages and a source-cited, versioned qualification model.
- `calculate_qualification_scenario`: hypothetical semester/exam targets and EFZ module/üK/IPA inputs.

Qualifications currently cover GIBS Solothurn Informatiker EFZ Applikationsentwicklung BiVo2021 with the pre-2026 eight-semester BM1 TALS profile. Other programmes and newer BM cohorts require additional profiles. Missing data is not zero and a running average is not an official certificate mark. Source conflicts and unsupported calculations are shown explicitly.

Disconnect the chatbot in dashboard settings to revoke its access. Connections expire after thirty days and may require a new sign-in. Free hosting can take time to wake after inactivity.
