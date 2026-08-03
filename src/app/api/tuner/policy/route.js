import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { canEditCombos } from "../auth";

export const dynamic = "force-dynamic";

const TUNER_DIR = "/app/tuner";
const BENCH_PATH = path.join(TUNER_DIR, "bench.json");
const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

const VALID_FIELDS = new Set(["band", "depth", "requires", "quotaGroup", "subscriptionPrefixes"]);

export async function POST(request) {
  if (!(await canEditCombos())) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { combo, field, value } = body;
  if (!combo || !field || value === undefined) {
    return NextResponse.json({ error: "combo, field, and value are required" }, { status: 400 });
  }

  if (!VALID_FIELDS.has(field)) {
    return NextResponse.json(
      { error: `Invalid field: ${field}. Valid: ${[...VALID_FIELDS].join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const bench = JSON.parse(fs.readFileSync(BENCH_PATH, "utf8"));

    switch (field) {
      case "band":
        bench._comboBand = bench._comboBand || {};
        bench._comboBand[combo] = String(value);
        break;
      case "depth":
        bench._comboDepth = bench._comboDepth || {};
        const depth = Number(value);
        if (!Number.isFinite(depth) || depth < 0) {
          return NextResponse.json({ error: "depth must be a non-negative number" }, { status: 400 });
        }
        bench._comboDepth[combo] = depth;
        break;
      case "requires":
        bench._comboRequires = bench._comboRequires || {};
        bench._comboRequires[combo] = Array.isArray(value) ? value : [String(value)];
        break;
      case "quotaGroup":
        bench.quotaGroup = bench.quotaGroup || {};
        bench.quotaGroup[combo] = String(value);
        break;
      case "subscriptionPrefixes":
        bench._subscriptionPrefixes = Array.isArray(value) ? value : [String(value)];
        break;
    }

    fs.writeFileSync(BENCH_PATH, JSON.stringify(bench, null, 2) + "\n");

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.log("tuner policy error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
