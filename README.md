# Pulse MCP

MCP server for [Pulse](https://pulsebenchmarks.com) — the open compute-pricing reference. Daily GPU and inference-token medians, free under CC-BY 4.0.

The server is hosted at `https://pulsebenchmarks.com/mcp`. This repository is a public mirror of the production handler, kept here so MCP registries and end users have a stable source URL.

## What you can do with it

Install the server in Claude Desktop, Cursor, Cline, or any MCP-aware client. You get five tools that wrap the public Pulse API and return JSON with pre-formatted citations:

- `list_indices` — every published index with current value, freshness, and methodology version
- `get_series` — full payload for one index: history, per-provider observations, contributing-provider list
- `latest_value` — quick lookup for one index, with `cite_as` string ready to paste
- `get_status` — pipeline freshness and per-provider collection health
- `compare_indices` — current values across multiple indices side-by-side

The data covers four GPU series (H100 SXM and A100 80GB, hyperscaler vs neocloud), four additional neocloud series (B200, H200 141GB, H100 PCIe, A100 80GB spot), and an inference-token basket anchored on Llama 3.3 70B FP8.

## Install

The server is hosted, so the install is the same on every client: point `mcp-remote` at the public endpoint.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on Windows/Linux:

```json
{
  "mcpServers": {
    "pulse": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://pulsebenchmarks.com/mcp"]
    }
  }
}
```

Restart Claude Desktop. You should see `pulse` in the tools menu.

### Cursor

Add to `~/.cursor/mcp.json` (or use the in-app MCP settings). Same JSON as above; full file in [`examples/cursor_mcp.json`](examples/cursor_mcp.json).

### Cline / other clients

Any MCP client that speaks `mcp-remote` over HTTP works the same way. The endpoint is `https://pulsebenchmarks.com/mcp`; transport is JSON-RPC 2.0 over POST; no auth.

## Tools

| Tool | Description |
|------|-------------|
| `list_indices` | List every published Pulse compute-pricing index with its current value, freshness, methodology version, and status. |
| `get_series` | Fetch the full payload for one Pulse index: metadata, gated daily headline series, per-provider observations, contributing-provider list. Optional `range` filter (`30d` / `90d` / `1y` / `all`). |
| `latest_value` | Quick lookup: the latest published value for one index, with minimal payload and a ready-to-paste `cite_as` string. |
| `get_status` | Pipeline freshness and per-provider collection health. |
| `compare_indices` | Compare current values across multiple Pulse indices (e.g. hyperscaler vs neocloud for the same GPU). |

Full input schemas and tool implementations are in [`functions/mcp.js`](functions/mcp.js).

## Data and methodology

The MCP server is a thin wrapper over Pulse's public HTTP endpoints. The same data is available without an MCP client:

- Methodology: <https://pulsebenchmarks.com/methodology/>
- Public API: `GET https://pulsebenchmarks.com/api/indices`, `GET https://pulsebenchmarks.com/api/indices/{slug}`, `GET https://pulsebenchmarks.com/api/status`
- Bulk export (CC-BY 4.0): <https://pulsebenchmarks.com/data/data_export.json>
- Reproducibility script: <https://pulsebenchmarks.com/methodology/#reproducibility>
- Agent guide: <https://pulsebenchmarks.com/llms.txt>

Methodology v1.0 covers four headline GPU series (H100 SXM and A100 80GB, hyperscaler vs neocloud) plus a Llama 3.3 70B FP8 inference-token basket. Series additions and methodology changes are versioned and documented in the [methodology changelog](https://pulsebenchmarks.com/methodology/#changelog).

## Self-host

The handler is a single Cloudflare Pages Function: [`functions/mcp.js`](functions/mcp.js). It has no dependencies, no build step, and no environment variables. To deploy your own:

1. Drop `functions/mcp.js` into a Cloudflare Pages project (or adapt to Workers — `onRequest` maps to `fetch` with minor changes).
2. The handler issues same-origin sub-requests to `/api/indices`, `/api/indices/{slug}`, and `/api/status` — point those at the public Pulse endpoints, or proxy them through your own deployment.
3. Hit `GET /mcp` to confirm the discovery payload returns; hit `POST /mcp` with an `initialize` JSON-RPC envelope to confirm the protocol layer.

For most users we recommend the hosted server. Self-hosting is mainly useful if you want to add caching, vendor it into a private network, or extend the tool set against the same public endpoints.

## License

- Server code (this repository): [Apache License 2.0](LICENSE)
- Pricing data returned by the server: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) (CC-BY 4.0)

When citing a value, prefer the `cite_as` string returned by `latest_value`. It already includes the index name, methodology version, year, and canonical URL.

## Contact and contributions

- Email: <methodology@pulsebenchmarks.com>
- Issues: <https://github.com/pulsebenchmarks/pulse-mcp/issues>

The production handler lives in the main Pulse codebase; changes there flow into this repository on a release cadence. PRs are reviewed as time allows; for fast turnaround on data or tool-shape changes, open an issue first so we can align before you write code.
