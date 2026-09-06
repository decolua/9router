import { NextResponse } from "next/server";
import {
  executeRequestTransformer,
  executeResponseTransformer,
  interpolateObject,
  interpolateTemplate,
} from "open-sse/custom-adapters/transformer.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";

export const dynamic = "force-dynamic";

// POST /api/custom-adapters/test - Test adapter transformation and connectivity
export async function POST(request) {
  try {
    const body = await request.json();
    const { adapter, model = "test-model", prompt = "Hello, this is a test.", messages, apiKey = "", cookie = "", live = false } = body;

    if (!adapter || !adapter.baseUrl) {
      return NextResponse.json({ error: "Adapter definition with baseUrl is required" }, { status: 400 });
    }

    const testMessages = messages || [
      { role: "user", content: prompt },
    ];

    const credentials = {
      apiKey,
      cookie,
      providerSpecificData: { cookie, ...(adapter.providerSpecificData || {}) },
    };

    const context = {
      model,
      credentials,
      apiKey,
      cookie,
      stream: false,
      baseUrl: adapter.baseUrl,
      adapter,
    };

    // 1. Build headers
    const rawHeaders = {
      "Content-Type": "application/json",
      ...(adapter.headers || {}),
    };
    const interpolatedHeaders = interpolateObject(rawHeaders, context);

    if (adapter.authType === "bearer" && !interpolatedHeaders["Authorization"] && !interpolatedHeaders["authorization"]) {
      if (apiKey) interpolatedHeaders["Authorization"] = `Bearer ${apiKey}`;
    } else if (adapter.authType === "apikey" && !interpolatedHeaders["x-api-key"] && !interpolatedHeaders["X-API-Key"]) {
      if (apiKey) interpolatedHeaders["x-api-key"] = apiKey;
    } else if (adapter.authType === "cookie" && !interpolatedHeaders["Cookie"] && !interpolatedHeaders["cookie"]) {
      if (cookie || apiKey) interpolatedHeaders["Cookie"] = cookie || apiKey;
    }

    // 2. Build and transform request
    const requestPayload = {
      model,
      messages: testMessages,
      temperature: 0.7,
      stream: false,
    };

    const reqTransform = executeRequestTransformer(adapter, {
      model,
      body: requestPayload,
      headers: interpolatedHeaders,
      credentials,
      stream: false,
    });

    const targetUrl = reqTransform.url || interpolateTemplate(adapter.baseUrl, context);
    const targetHeaders = reqTransform.headers || interpolatedHeaders;
    const targetMethod = reqTransform.method || "POST";
    const targetBody = reqTransform.body;

    const result = {
      success: true,
      transformedRequest: {
        url: targetUrl,
        method: targetMethod,
        headers: targetHeaders,
        body: targetBody,
      },
    };

    // 3. If live test is requested, perform actual HTTP request
    if (live) {
      const t0 = Date.now();
      try {
        const fetchOptions = {
          method: targetMethod,
          headers: targetHeaders,
        };
        if (targetMethod.toUpperCase() !== "GET" && targetMethod.toUpperCase() !== "HEAD") {
          fetchOptions.body = typeof targetBody === "string" ? targetBody : JSON.stringify(targetBody);
        }

        const res = await proxyAwareFetch(targetUrl, fetchOptions);
        const durationMs = Date.now() - t0;
        result.durationMs = durationMs;
        result.status = res.status;
        result.statusText = res.statusText;

        const resText = await res.text();
        let resJson = null;
        try {
          resJson = JSON.parse(resText);
        } catch {
          resJson = { raw: resText };
        }

        result.rawResponse = resJson;

        if (res.ok) {
          result.transformedResponse = executeResponseTransformer(adapter, resJson, {}, model);
        } else {
          result.error = `Upstream error ${res.status}: ${resText.slice(0, 300)}`;
        }
      } catch (err) {
        result.liveError = err.message;
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error testing custom adapter:", error);
    return NextResponse.json({ error: error.message || "Test failed" }, { status: 500 });
  }
}
