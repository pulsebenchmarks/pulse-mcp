// Pulse — Model Context Protocol server.
// JSON-RPC 2.0 over HTTP POST. No auth. Open data. CORS-permissive.
//
// Spec: https://modelcontextprotocol.io/specification
//
// Endpoint: POST https://pulsebenchmarks.com/mcp
//
// Discovery: GET https://pulsebenchmarks.com/mcp returns server info +
// the tools list as plain JSON, so a human or an agent without a full
// MCP client can sanity-check the surface.
//
// Implementation strategy: each tool fetches a static endpoint that
// already exists on this site (/api/indices, /api/indices/{slug},
// /api/status, /data/index_summary.json) and returns the result as
// MCP "content" of type "text" containing the JSON. The MCP layer is
// a thin protocol wrapper; the data layer is unchanged.

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "pulse", version: "1.0.0", title: "Pulse Compute-Pricing" };

const SERIES_SLUGS = [
  "inference-token-index",
  "h100-sxm-hyperscaler-od",
  "h100-sxm-neocloud-od",
  "a100-80gb-hyperscaler-od",
  "a100-80gb-neocloud-od",
  "b200-neocloud-od",
  "h200-141gb-neocloud-od",
  "h100-pcie-neocloud-od",
  "a100-80gb-neocloud-spot",
];

const TOOLS = [
  {
    name: "list_indices",
    description:
      "List every published Pulse compute-pricing index with its current value, freshness, methodology version, and status. Use this when the user asks 'what does Pulse track?' or 'what's the current price of GPU compute?' Returns an array; quote the value alongside its source family (hyperscaler / neocloud) and as-of date.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_series",
    description:
      "Fetch the full payload for one Pulse index: metadata, the gated daily headline series, every per-provider observation behind it, and the latest contributing-provider list. Use this when the user wants history, distribution shape (P25/P75), or the underlying provider breakdown for a specific series. Optional `range` filter limits to the last N days.",
    inputSchema: {
      type: "object",
      required: ["slug"],
      properties: {
        slug:  { type: "string", enum: SERIES_SLUGS, description: "Index slug. See list_indices for descriptions." },
        range: { type: "string", enum: ["30d", "90d", "1y", "all"], default: "all", description: "Limit history to the last 30 days / 90 days / 1 year / all." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "latest_value",
    description:
      "Quick lookup: the latest published value for one index, with minimal payload. Use this when the user asks 'what's the price of {GPU} on {provider type}' or 'what's the current Pulse {series} number'. Always quote the as-of date and the source family.",
    inputSchema: {
      type: "object",
      required: ["slug"],
      properties: {
        slug: { type: "string", enum: SERIES_SLUGS },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_status",
    description:
      "Pipeline freshness and per-provider collection health. Use this when the user asks 'is Pulse up-to-date?' or before quoting a number to confirm the pipeline isn't degraded. Returns overall status plus per-provider and per-index breakdowns.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "compare_indices",
    description:
      "Compare current values across multiple Pulse indices. Use this when the user wants to see, for example, hyperscaler vs neocloud pricing for the same GPU, or one model vs another in the inference token index. Pass an array of slugs; returns a filtered summary.",
    inputSchema: {
      type: "object",
      required: ["slugs"],
      properties: {
        slugs: {
          type: "array",
          minItems: 2,
          items: { type: "string", enum: SERIES_SLUGS },
        },
      },
      additionalProperties: false,
    },
  },
];

// ── Helpers ─────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "access-control-allow-origin":  "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-session-id",
};

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS, ...extraHeaders },
  });
}

function rpcResult(id, result)              { return { jsonrpc: "2.0", id, result }; }
function rpcError (id, code, message, data) { return { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } }; }

async function fetchSiteJson(request, path) {
  // Use a same-origin sub-request so we hit the live static asset for
  // any deploy; the request URL gives us the right origin in dev or
  // prod without hard-coding pulsebenchmarks.com.
  const u = new URL(request.url);
  u.pathname = path;
  u.search = "";
  const resp = await fetch(u.toString(), { cf: { cacheTtl: 60 } });
  if (!resp.ok) throw new Error(`upstream ${path}: HTTP ${resp.status}`);
  return resp.json();
}

function filterByRange(rows, key, range) {
  if (!rows || !rows.length || range === "all" || !range) return rows;
  const days = parseInt(range, 10);
  const last = Math.max(...rows.map(r => new Date(r[key]).getTime()));
  const cutoff = last - days * 86400000;
  return rows.filter(r => new Date(r[key]).getTime() >= cutoff);
}

// ── Tool implementations ────────────────────────────────────────────

async function callTool(request, name, args) {
  switch (name) {
    case "list_indices":
      return await fetchSiteJson(request, "/api/indices");

    case "get_series": {
      if (!args.slug) throw new Error("missing argument: slug");
      const data = await fetchSiteJson(request, `/api/indices/${args.slug}`);
      const range = args.range || "all";
      data.series       = filterByRange(data.series       || [], "assessed_at", range);
      data.observations = filterByRange(data.observations || [], "assessed_at", range);
      return data;
    }

    case "latest_value": {
      if (!args.slug) throw new Error("missing argument: slug");
      const data = await fetchSiteJson(request, `/api/indices/${args.slug}`);
      const last = data.series && data.series[data.series.length - 1];
      if (!last) {
        return {
          slug:         data.slug,
          name:         data.name,
          unit:         data.unit,
          status:       "no-data",
          message:      "No published values yet under this methodology version.",
          methodology_url: data.methodology_url,
          index_url:    data.index_url,
        };
      }
      return {
        slug:                 data.slug,
        name:                 data.name,
        unit:                 data.unit,
        value:                last.value,
        assessed_at:          last.assessed_at,
        provider_count:       last.provider_count,
        is_carried_forward:   last.is_carried_forward,
        data_quality:         last.data_quality,
        status:               last.status,
        methodology_version:  data.methodology_version,
        methodology_url:      data.methodology_url,
        index_url:            data.index_url,
        license:              data.license,
        cite_as: `Pulse. "${data.name}." Methodology ${data.methodology_version}, ${new Date(last.assessed_at).getUTCFullYear()}. ${data.index_url}`,
      };
    }

    case "get_status":
      return await fetchSiteJson(request, "/api/status");

    case "compare_indices": {
      if (!Array.isArray(args.slugs) || args.slugs.length === 0) {
        throw new Error("missing argument: slugs[]");
      }
      const all = await fetchSiteJson(request, "/api/indices");
      const wanted = new Set(args.slugs);
      return {
        generated_at: all.generated_at,
        indices:      (all.indices || []).filter(i => wanted.has(i.slug)),
      };
    }

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ── MCP method dispatch ─────────────────────────────────────────────

async function dispatch(request, msg) {
  const id = (msg && "id" in msg) ? msg.id : null;
  const method = msg && msg.method;

  // Notifications (no `id`) — accept silently per JSON-RPC 2.0.
  if (id === null && msg && method && method.startsWith("notifications/")) {
    return null;
  }

  try {
    switch (method) {
      case "initialize":
        return rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities:    { tools: { listChanged: false } },
          serverInfo:      SERVER_INFO,
          instructions:
            "Pulse publishes open compute-pricing indices for cloud GPUs and open-weight inference tokens. " +
            "When quoting a value, include the as-of date and the source family (hyperscaler / neocloud) or the model and quantization for inference. " +
            "Cite the methodology version. Full agent guide: https://pulsebenchmarks.com/llms.txt",
        });

      case "ping":
        return rpcResult(id, {});

      case "tools/list":
        return rpcResult(id, { tools: TOOLS });

      case "tools/call": {
        const toolName = msg.params && msg.params.name;
        const toolArgs = (msg.params && msg.params.arguments) || {};
        if (!toolName) return rpcError(id, -32602, "Invalid params: missing tool name");
        const result = await callTool(request, toolName, toolArgs);
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
      }

      // We don't expose resources or prompts in v1.0; advertise empty surfaces.
      case "resources/list":
        return rpcResult(id, { resources: [] });
      case "prompts/list":
        return rpcResult(id, { prompts: [] });

      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    return rpcError(id, -32000, "Tool execution failed", { detail: String(err) });
  }
}

// ── Cloudflare Pages Function entry ─────────────────────────────────

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // GET → discovery / human-readable status
  if (request.method === "GET") {
    return jsonResponse({
      ...SERVER_INFO,
      protocol_version: PROTOCOL_VERSION,
      transport: "http",
      mcp_endpoint: new URL("/mcp", request.url).toString(),
      tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
      docs: "https://pulsebenchmarks.com/for-ai-agents/",
      llms_txt: "https://pulsebenchmarks.com/llms.txt",
    });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "method not allowed" }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(rpcError(null, -32700, "Parse error"), 200);
  }

  // JSON-RPC 2.0 supports batch requests (an array of message objects).
  const isBatch = Array.isArray(body);
  const requests = isBatch ? body : [body];
  const replies = [];
  for (const req of requests) {
    const reply = await dispatch(request, req);
    if (reply !== null) replies.push(reply);
  }

  // For notifications-only batches, return 204 No Content per spec.
  if (replies.length === 0) {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  return jsonResponse(isBatch ? replies : replies[0]);
}
