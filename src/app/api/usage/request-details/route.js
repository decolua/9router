import { NextResponse } from "next/server";
import { getRequestDetails, isObservabilityRecording, observabilityEnvSource } from "@/lib/usageDb";

/**
 * GET /api/usage/request-details
 * Query parameters: page, pageSize (1-100), provider, model, connectionId, status, startDate, endDate
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    
    const pageRaw = parseInt(searchParams.get("page"));
    const page = Number.isNaN(pageRaw) ? 1 : pageRaw;
    const pageSizeRaw = parseInt(searchParams.get("pageSize"));
    const pageSize = Number.isNaN(pageSizeRaw) ? 20 : pageSizeRaw;
    const provider = searchParams.get("provider");
    const model = searchParams.get("model");
    const connectionId = searchParams.get("connectionId");
    const status = searchParams.get("status");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    
    if (page < 1) {
      return NextResponse.json(
        { error: "Page must be >= 1" },
        { status: 400 }
      );
    }
    
    if (pageSize < 1 || pageSize > 100) {
      return NextResponse.json(
        { error: "PageSize must be between 1 and 100" },
        { status: 400 }
      );
    }
    
    const filter = {
      page,
      pageSize
    };
    
    if (provider) filter.provider = provider;
    if (model) filter.model = model;
    if (connectionId) filter.connectionId = connectionId;
    if (status) filter.status = status;
    if (startDate) filter.startDate = startDate;
    if (endDate) filter.endDate = endDate;
    
    const result = await getRequestDetails(filter);

    // Redact conversation payloads: the stored details include full request
    // bodies (user prompts, tool calls) and provider responses. Returning them
    // wholesale lets any dashboard-authenticated user (or, if requireLogin is
    // disabled, anyone) read every user's conversation history. Keep the
    // metadata (model, tokens, latency, status) but drop message content.
    //
    // Unless the operator turned that off. Diagnosing a client that loops, or
    // a provider that answers with the wrong shape, needs the bodies — and
    // reading them off the server's disk is the alternative, which is worse.
    // Deliberately an environment variable and not a dashboard setting: it
    // takes access to the server, not just a session on it.
    const includePayloads = process.env.OBSERVABILITY_INCLUDE_PAYLOADS === "true";
    const redactedDetails = includePayloads
      ? (result.details || [])
      : (result.details || []).map((d) => {
        const redacted = { ...d };
        for (const key of ["request", "providerRequest", "providerResponse", "response"]) {
          if (redacted[key] !== undefined) {
            redacted[key] = { redacted: true };
          }
        }
        // The conversation's shape is not its contents: turn counts, tool names
        // and ids, block types and text lengths. It is what a stuck client is
        // diagnosed from, and hiding it with the bodies left the record saying
        // only how many characters went down the pipe.
        const shape = d.providerRequest?.conversation;
        if (shape) redacted.providerRequest = { redacted: true, conversation: shape };
        return redacted;
      });

    // Without this an empty list is ambiguous: nothing recorded, or recording
    // switched off. They need different things from the reader.
    return NextResponse.json({
      ...result,
      details: redactedDetails,
      recording: await isObservabilityRecording(),
      // Which control settled it. The tab used to tell the operator to flip the
      // dashboard switch, which an environment variable overrides in silence —
      // advice that cannot work is worse than none.
      recordingSource: observabilityEnvSource(),
      // So the drawer can say the bodies are hidden rather than look broken.
      payloadsRedacted: !includePayloads,
    });
  } catch (error) {
    console.error("[API] Failed to get request details:", error);
    return NextResponse.json(
      { error: "Failed to fetch request details" },
      { status: 500 }
    );
  }
}
