// API endpoint for fetching system specifications
import { getRecommendedWorkerCount, getSystemSpecs } from "@/lib/systemSpecs";

export const dynamic = "force-dynamic";

export async function GET() {
  const specs = getSystemSpecs();
  const recommended = getRecommendedWorkerCount();
  
  return Response.json({
    ...specs,
    recommendedWorkers: recommended.recommended,
    limitedBy: recommended.limitedBy,
    ramBudget: recommended.ramBudget,
    cpuBudget: recommended.cpuBudget,
    minWorkers: recommended.minWorkers,
    maxWorkers: recommended.maxWorkers,
  });
}
