import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { canEditCombos } from "../auth";

export const dynamic = "force-dynamic";

const TUNER_DIR = "/app/tuner";
const BENCH_PATH = path.join(TUNER_DIR, "bench.json");
const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

export async function POST(request) {
  if (!(await canEditCombos())) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { combo, model, index, unpin } = body;
  if (!combo || !model) {
    return NextResponse.json({ error: "combo and model are required" }, { status: 400 });
  }

  try {
    const bench = JSON.parse(fs.readFileSync(BENCH_PATH, "utf8"));
    bench._pins = bench._pins || {};

    if (unpin) {
      if (bench._pins[combo]?.[model] !== undefined) {
        delete bench._pins[combo][model];
        if (Object.keys(bench._pins[combo]).length === 0) delete bench._pins[combo];
      }
    } else {
      bench._pins[combo] = bench._pins[combo] || {};
      bench._pins[combo][model] = typeof index === "number" ? index : 0;
    }

    fs.writeFileSync(BENCH_PATH, JSON.stringify(bench, null, 2) + "\n");

    return NextResponse.json({
      ok: true,
      unpinned: unpin === true,
      combo,
      model,
      index: unpin ? null : (typeof index === "number" ? index : 0),
      pins: bench._pins,
    });
  } catch (error) {
    console.log("tuner pin error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
