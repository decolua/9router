import { NextResponse } from "next/server";
import { getUsageHistory } from "@/lib/usageDb";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") || "json";
    const history = await getUsageHistory();

    if (format === "csv") {
      const headers = ["timestamp", "provider", "model", "connectionId", "apiKeyMasked", "endpoint", "status", "cost", "promptTokens", "completionTokens"];
      const rows = history.map((r) => {
        const promptTokens = r.tokens?.prompt_tokens || r.tokens?.input_tokens || 0;
        const completionTokens = r.tokens?.completion_tokens || r.tokens?.output_tokens || 0;
        return [
          r.timestamp,
          r.provider || "",
          r.model || "",
          r.connectionId || "",
          r.apiKeyMasked || "",
          r.endpoint || "",
          r.status || "ok",
          r.cost || 0,
          promptTokens,
          completionTokens,
        ].map((val) => `"${String(val).replace(/"/g, '""')}"`).join(",");
      });

      const csvContent = [headers.join(","), ...rows].join("\n");
      return new NextResponse(csvContent, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="usage-report-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    return NextResponse.json({ history });
  } catch (error) {
    console.error("Error fetching usage history:", error);
    return NextResponse.json({ error: "Failed to fetch usage history" }, { status: 500 });
  }
}
