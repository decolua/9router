import { NextResponse } from "next/server";
import { getCombos, getSettings } from "@/lib/localDb";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [combos, settings] = await Promise.all([
      getCombos(),
      getSettings(),
    ]);

    const comboStrategies = settings?.comboStrategies || {};
    const capacityAdapter = settings?.capacityAdapter || null;

    const exportData = {
      version: 2,
      exportedAt: new Date().toISOString(),
      ...(capacityAdapter ? { capacityAdapter } : {}),
      combos: combos.map((combo) => {
        const strategy = comboStrategies[combo.name];
        return {
          name: combo.name,
          kind: combo.kind,
          models: combo.models,
          strategy: strategy
            ? {
                fallbackStrategy: strategy.fallbackStrategy || "fallback",
                ...(strategy.judgeModel ? { judgeModel: strategy.judgeModel } : {}),
              }
            : { fallbackStrategy: "fallback" },
        };
      }),
    };

    const jsonStr = JSON.stringify(exportData, null, 2);

    return new NextResponse(jsonStr, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="combos-export.json"`,
      },
    });
  } catch (error) {
    console.log("Error exporting combos:", error);
    return NextResponse.json({ error: "Failed to export combos" }, { status: 500 });
  }
}
