import { handleFetch } from "@/sse/handlers/fetch.js";

function cors(response) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  return response;
}

function providerFromPath(model) {
  const value = model.filter(Boolean).join("/");
  return value.endsWith("/fetch") ? value.slice(0, -"/fetch".length) : value;
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

// Open WebUI external loader: POST /v1/web/fetch/{provider} { urls: [...] }
// → [{ page_content, metadata }]. Fetch remains sequential to reuse the
// existing credential fallback and SSRF checks for every URL.
export async function POST(request, { params }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return cors(Response.json({ error: { message: "Invalid JSON body" } }, { status: 400 }));
  }

  const provider = providerFromPath((await params).model || []);
  if (!provider) return cors(Response.json({ error: { message: "Missing provider" } }, { status: 400 }));
  if (!Array.isArray(body.urls) || !body.urls.length || !body.urls.every((url) => typeof url === "string")) {
    return cors(Response.json({ error: { message: "urls must be a non-empty array of strings" } }, { status: 400 }));
  }

  const documents = [];
  for (const url of body.urls) {
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    const response = await handleFetch(new Request(request.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, model: provider, url }),
    }));
    if (!response.ok) return cors(response);
    const data = await response.json();
    documents.push({
      page_content: data.content?.text || "",
      metadata: { ...data.metadata, source: data.url || url, ...(data.title ? { title: data.title } : {}) },
    });
  }
  return cors(Response.json(documents));
}
