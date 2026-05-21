import { NextResponse } from "next/server";
import { PioneerService } from "@/lib/oauth/services/pioneer";
import { getProviderConnectionById } from "@/models";

/**
 * GET  /api/oauth/pioneer/training-jobs?connectionId=...&status=...
 *   List training jobs for this connection.
 *
 * POST /api/oauth/pioneer/training-jobs
 *   Body: { connectionId, model_name, base_model, datasets, training_type,
 *           nr_epochs, learning_rate, ... }
 *   Start a new fine-tuning job.
 */
export const dynamic = "force-dynamic";

async function requirePioneerConnection(connectionId) {
  if (!connectionId) {
    return { error: "connectionId is required", status: 400 };
  }
  const conn = await getProviderConnectionById(connectionId);
  if (!conn || conn.provider !== "pioneer") {
    return { error: "Pioneer connection not found", status: 404 };
  }
  if (!conn.apiKey) {
    return { error: "Connection has no API key stored", status: 400 };
  }
  return { conn };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get("connectionId");
    const status = searchParams.get("status");
    const limitRaw = Number(searchParams.get("limit"));
    const offsetRaw = Number(searchParams.get("offset"));

    const gate = await requirePioneerConnection(connectionId);
    if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const pioneer = new PioneerService();
    const jobs = await pioneer.listTrainingJobs(gate.conn.apiKey, {
      limit: Number.isFinite(limitRaw) ? limitRaw : 100,
      offset: Number.isFinite(offsetRaw) ? offsetRaw : 0,
      status: status || null,
    });
    return NextResponse.json({ success: true, jobs });
  } catch (error) {
    console.log("Pioneer list training-jobs error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to list training jobs" },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { connectionId, ...trainingBody } = body || {};
    const gate = await requirePioneerConnection(connectionId);
    if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

    if (!trainingBody.base_model) {
      return NextResponse.json({ error: "base_model is required" }, { status: 400 });
    }
    if (!trainingBody.model_name) {
      return NextResponse.json({ error: "model_name is required" }, { status: 400 });
    }

    const pioneer = new PioneerService();
    const job = await pioneer.startTrainingJob(gate.conn.apiKey, trainingBody);
    return NextResponse.json({ success: true, job }, { status: 201 });
  } catch (error) {
    console.log("Pioneer start training-job error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to start training job" },
      { status: 500 }
    );
  }
}
