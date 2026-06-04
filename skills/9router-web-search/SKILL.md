---
name: 9router-web-search
description: Web search via 9Router /v1/search using Tavily / Exa / Brave / Serper / SearXNG / Google PSE / Linkup / SearchAPI / You.com / Perplexity. Use when the user wants to search the web, look up information, find articles, or query a search engine.
---

# 9Router — Web Search

Requires `NINEROUTER_URL` (and `NINEROUTER_KEY` if auth enabled). See https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router/SKILL.md for setup.

## Discover

```bash
curl $NINEROUTER_URL/v1/models/web | jq '.data[] | select(.kind=="webSearch") | .id'
# Per-provider params (searchTypes, maxResults, required options like cx for google-pse)
curl "$NINEROUTER_URL/v1/models/info?id=tavily/search"
```

IDs end in `/search` (e.g. `tavily/search`). Combos (`owned_by:"combo"`) chain providers with auto-fallback.

## Endpoint

`POST $NINEROUTER_URL/v1/search`

| Field | Required | Notes |
|---|---|---|
| `model` (or `provider`) | yes | from `/v1/models/web` (e.g. `tavily` or `brave`) |
| `query` | yes | search query |
| `max_results` | no | default 5 |
| `search_type` | no | `web` (default) / `news` |
| `country`, `language`, `time_range`, `domain_filter` | no | provider-dependent |

## Examples

```bash
curl -X POST $NINEROUTER_URL/v1/search \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"tavily","query":"9Router open source","max_results":5}'
```

JS:

```js
const r = await fetch(`${process.env.NINEROUTER_URL}/v1/search`, {
  method: "POST",
  headers: { "Authorization": `Bearer ${process.env.NINEROUTER_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model: "search-combo", query: "latest LLM benchmarks", max_results: 10 }),
});
console.log(await r.json());
```

## Response shape

```json
{
  "provider": "tavily",
  "query": "9Router open source",
  "results": [
    {
      "title": "...", "url": "https://...", "display_url": "github.com/...",
      "snippet": "...", "position": 1, "score": 0.92,
      "published_at": null, "favicon_url": null, "content": null,
      "metadata": { "author": null, "language": null, "source_type": null, "image_url": null },
      "citation": { "provider": "tavily", "retrieved_at": "2026-...", "rank": 1 }
    }
  ],
  "answer": null,
  "usage": { "queries_used": 1, "search_cost_usd": 0.008 },
  "metrics": { "response_time_ms": 850, "upstream_latency_ms": 700, "total_results_available": 12 },
  "errors": []
}
```

## Provider quirks

All accept `query` + `max_results`. Optional fields vary:

| Provider | Supports | Required extras |
|---|---|---|
| `tavily` | country, domain_filter, news topic | — |
| `exa` | domain_filter (incl/excl), news category | — |
| `brave-search` | country, language | — |
| `serper` | country, language, news endpoint | — |
| `perplexity` | country, language, domain_filter | — |
| `linkup` | domain_filter, time_range | `depth: fast/standard/deep` (option) |
| `google-pse` | country, language, time_range, offset | **`cx` required** (providerOptions) |
| `searchapi` | country, language, pagination | — |
| `youcom` | country, language, time_range, domain_filter, full_page | — |
| `searxng` | language, time_range | Self-hosted, **noAuth** |

Provider IS the model — `"provider":"tavily" ≡ "model":"tavily"`.
