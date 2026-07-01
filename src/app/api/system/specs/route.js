import { NextResponse } from "next/server";
import { getRecommendedWorkerCount } from "@/lib/systemSpecs";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = getRecommendedWorkerCount();
  return NextResponse.json({
    success: true,
    recommended: result.recommended,
    limitedBy: result.limitedBy,
    ramBudget: result.ramBudget,
    cpuBudget: result.cpuBudget,
    minWorkers: result.minWorkers,
    maxWorkers: result.maxWorkers,
    ramGbPerWorker: result.ramGbPerWorker,
    cpuDivisor: result.cpuDivisor,
    specs: {
      cpuCount: result.specs.cpuCount,
      cpuModel: result.specs.cpuModel,
      totalMemGb: Number((result.specs.totalMemGb || 0).toFixed(2)),
      freeMemGb: Number((result.specs.freeMemGb || 0).toFixed(2)),
      platform: result.specs.platform,
      arch: result.specs.arch,
    },
  });
}
