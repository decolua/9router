import { handleSearch } from "@/sse/handlers/search.js";

function cors(response) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  return response;
}

function providerFromPath(model) {
  const value = model.filter(Boolean).join("/");
  return value.endsWith("/search") ? value.slice(0, -"/search".length) : value;
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

// Open WebUI external search: POST /v1/search/{provider} { query, count }
// → [{ link, title, snippet }]. The provider is intentionally path-bound so
// Open WebUI's fixed external-search payload never needs a model field.
export async function POST(request, { params }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return cors(Response.json({ error: { message: "Invalid JSON body" } }, { status: 400 }));
  }

  const provider = providerFromPath((await params).model || []);
  if (!provider) return cors(Response.json({ error: { message: "Missing provider" } }, { status: 400 }));

  const headers = new Headers(request.headers);
  headers.delete("content-length");
  const response = await handleSearch(new Request(request.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, model: provider, max_results: body.max_results ?? body.count }),
  }));
  if (!response.ok) return cors(response);

  const data = await response.json();
  return cors(Response.json((data.results || []).map((result) => ({
    link: result.url,
    title: result.title,
    snippet: result.snippet,
  }))));
}
