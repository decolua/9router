/**
 * Search Response Normalizers
 *
 * Ported from OmniRoute open-sse/handlers/search.ts.
 * Each normalizer maps a provider-specific response into the unified SearchResult shape.
 */

/** Build a unified SearchResult object. */
function makeResult(providerId, item, idx, now) {
  const url = item.url || "";
  return {
    title: item.title || "",
    url,
    display_url: url ? url.replace(/^https?:\/\/(www\.)?/, "").split("?")[0] : undefined,
    snippet: item.snippet || "",
    position: idx + 1,
    score: typeof item.score === "number" ? Math.min(1, Math.max(0, item.score)) : null,
    published_at: item.published_at || null,
    favicon_url: item.favicon_url || null,
    content: item.full_text
      ? { format: item.text_format || "text", text: item.full_text, length: item.full_text.length }
      : null,
    metadata: {
      author: item.author || null,
      language: null,
      source_type: item.source_type || null,
      image_url: item.image_url || null,
    },
    citation: { provider: providerId, retrieved_at: now, rank: idx + 1 },
    provider_raw: null,
  };
}

function normalizeSerper(data, _query, searchType) {
  const now = new Date().toISOString();
  const items = searchType === "news" ? data.news : data.organic;
  if (!Array.isArray(items)) return { results: [], totalResults: null };
  const results = items.map((item, idx) =>
    makeResult("serper", { title: item.title, url: item.link, snippet: item.snippet || item.description, published_at: item.date }, idx, now)
  );
  const total = data.searchParameters?.totalResults;
  return { results, totalResults: typeof total === "number" ? total : null };
}

function normalizeBrave(data, _query, searchType) {
  const now = new Date().toISOString();
  const container = searchType === "news" ? data.news || data : data.web;
  const items = container?.results;
  if (!Array.isArray(items)) return { results: [], totalResults: null };
  const results = items.map((item, idx) =>
    makeResult("brave-search", {
      title: item.title,
      url: item.url,
      snippet: item.description,
      published_at: item.page_age || item.age,
      favicon_url: item.meta_url?.favicon || item.favicon,
    }, idx, now)
  );
  return { results, totalResults: container?.totalCount ?? null };
}

function normalizePerplexity(data, _query, _searchType) {
  const now = new Date().toISOString();
  const items = data.results;
  if (!Array.isArray(items)) return { results: [], totalResults: null };
  const results = items.map((item, idx) =>
    makeResult("perplexity", { title: item.title, url: item.url, snippet: item.snippet, published_at: item.date || item.last_updated }, idx, now)
  );
  return { results, totalResults: results.length };
}

function normalizeExa(data, _query, _searchType) {
  const now = new Date().toISOString();
  const items = data.results;
  if (!Array.isArray(items)) return { results: [], totalResults: null };
  const results = items.map((item, idx) =>
    makeResult("exa", {
      title: item.title,
      url: item.url,
      snippet: item.highlights?.[0] || item.text?.slice(0, 300) || "",
      score: item.score,
      published_at: item.publishedDate,
      favicon_url: item.favicon,
      author: item.author,
      image_url: item.image,
      full_text: item.text,
      text_format: "text",
    }, idx, now)
  );
  return { results, totalResults: results.length };
}

function normalizeTavily(data, _query, _searchType) {
  const now = new Date().toISOString();
  const items = data.results;
  if (!Array.isArray(items)) return { results: [], totalResults: null };
  const results = items.map((item, idx) =>
    makeResult("tavily", {
      title: item.title,
      url: item.url,
      snippet: item.content || "",
      score: item.score,
      published_at: item.published_date,
      full_text: item.raw_content,
      text_format: "text",
    }, idx, now)
  );
  return { results, totalResults: results.length };
}

function normalizeGooglePse(data, _query, _searchType) {
  const now = new Date().toISOString();
  const items = Array.isArray(data.items) ? data.items : [];
  const results = items.map((item, idx) =>
    makeResult("google-pse", {
      title: item.title,
      url: item.link,
      snippet: item.snippet,
      image_url: item.pagemap?.cse_image?.[0]?.src || item.pagemap?.cse_thumbnail?.[0]?.src || item.pagemap?.metatags?.[0]?.["og:image"],
    }, idx, now)
  );
  const raw = data.searchInformation?.totalResults ?? data.queries?.request?.[0]?.totalResults ?? null;
  const total = typeof raw === "string" ? Number(raw) : raw;
  return { results, totalResults: Number.isFinite(total) ? total : null };
}

function normalizeLinkup(data, _query, _searchType) {
  const now = new Date().toISOString();
  const items = Array.isArray(data.results) ? data.results : [];
  const results = items.map((item, idx) =>
    makeResult("linkup", {
      title: item.name || item.title,
      url: item.url,
      snippet: item.content || item.snippet || "",
      source_type: item.type || "web",
      image_url: item.image_url || item.imageUrl || null,
      full_text: item.content,
      text_format: "text",
    }, idx, now)
  );
  return { results, totalResults: results.length };
}

function normalizeSearchApi(data, _query, _searchType) {
  const now = new Date().toISOString();
  const items = Array.isArray(data.organic_results) ? data.organic_results : Array.isArray(data.top_stories) ? data.top_stories : [];
  const results = items.map((item, idx) =>
    makeResult("searchapi", {
      title: item.title,
      url: item.link,
      snippet: item.snippet || item.description || "",
      published_at: item.date || item.published_at,
      favicon_url: item.favicon,
      author: item.source || null,
      image_url: item.thumbnail || null,
    }, idx, now)
  );
  const raw = data.search_information?.total_results;
  const total = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : null;
  return { results, totalResults: Number.isFinite(total) ? total : results.length };
}

function normalizeYouCom(data, _query, searchType) {
  const now = new Date().toISOString();
  const container = data?.results && typeof data.results === "object" ? data.results : undefined;
  const section = searchType === "news" ? container?.news || [] : container?.web || [];
  const items = Array.isArray(section) ? section : [];
  const results = items.map((item, idx) => {
    const firstSnippet = Array.isArray(item.snippets) ? item.snippets.find((v) => typeof v === "string") : null;
    const livecrawlText = typeof item.markdown === "string" ? item.markdown : typeof item.html === "string" ? item.html : undefined;
    const livecrawlFormat = typeof item.markdown === "string" ? "markdown" : "html";
    return makeResult("youcom", {
      title: item.title,
      url: item.url,
      snippet: typeof firstSnippet === "string" ? firstSnippet : typeof item.description === "string" ? item.description : "",
      published_at: item.page_age,
      favicon_url: item.favicon_url,
      image_url: item.thumbnail_url,
      source_type: searchType,
      full_text: livecrawlText,
      text_format: livecrawlText ? livecrawlFormat : undefined,
    }, idx, now);
  });
  return { results, totalResults: results.length };
}

function normalizeSearxng(data, _query, _searchType) {
  const now = new Date().toISOString();
  const items = Array.isArray(data.results) ? data.results : [];
  const results = items.map((item, idx) =>
    makeResult("searxng", {
      title: item.title,
      url: item.url,
      snippet: item.content || item.snippet || "",
      published_at: item.publishedDate || item.published_date || null,
      source_type: Array.isArray(item.engines) ? item.engines.join(", ") : item.engine || item.category || null,
      image_url: item.thumbnail || item.img_src || null,
    }, idx, now)
  );
  return { results, totalResults: results.length };
}

const NORMALIZERS = {
  "serper": normalizeSerper,
  "brave-search": normalizeBrave,
  "perplexity": normalizePerplexity,
  "exa": normalizeExa,
  "tavily": normalizeTavily,
  "google-pse": normalizeGooglePse,
  "linkup": normalizeLinkup,
  "searchapi": normalizeSearchApi,
  "youcom": normalizeYouCom,
  "searxng": normalizeSearxng,
};

/**
 * Dispatch to the appropriate normalizer based on providerId.
 * @returns {{results: Array, totalResults: number|null}}
 */
export function normalizeSearchResponse(providerId, data, query, searchType) {
  const fn = NORMALIZERS[providerId];
  return fn ? fn(data, query, searchType) : { results: [], totalResults: null };
}
