import { NextResponse } from "next/server";
import { getModelTestResults, saveModelTestResults, clearModelTestResults } from "@/lib/db/repos/modelTestResultsRepo.js";

export const dynamic = "force-dynamic";

// GET /api/models/test-results - persisted last-test status per routed model
export async function GET() {
  try {
    const results = await getModelTestResults();
    return NextResponse.json({ results });
  } catch (error) {
    console.log("Error fetching model test results:", error);
    return NextResponse.json({ error: "Failed to fetch model test results" }, { status: 500 });
  }
}

// POST /api/models/test-results  body: { results: { "alias/modelId": { state, latencyMs, error } } }
export async function POST(request) {
  try {
    const { results } = await request.json();
    if (!results || typeof results !== "object") {
      return NextResponse.json({ error: "results object required" }, { status: 400 });
    }
    await saveModelTestResults(results);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error saving model test results:", error);
    return NextResponse.json({ error: "Failed to save model test results" }, { status: 500 });
  }
}

// DELETE /api/models/test-results  body: { models: ["alias/modelId", ...] }
export async function DELETE(request) {
  try {
    const { models } = await request.json();
    if (!Array.isArray(models)) {
      return NextResponse.json({ error: "models[] required" }, { status: 400 });
    }
    await clearModelTestResults(models);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error clearing model test results:", error);
    return NextResponse.json({ error: "Failed to clear model test results" }, { status: 500 });
  }
}
