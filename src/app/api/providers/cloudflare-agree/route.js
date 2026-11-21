import { NextResponse } from "next/server";

import { getProviderConnections, updateProviderConnection } from "@/models";

export async function POST(request) {
  try {
    const { accountId, apiKey, connectionId } = await request.json();

    let targetAccountId = accountId;
    let targetApiKey = apiKey;
    let activeConnection = null;

    if (!targetAccountId || !targetApiKey) {
      if (connectionId) {
        const connections = await getProviderConnections({ provider: "cloudflare-ai" });
        activeConnection = connections.find(c => c.id === connectionId);
        if (activeConnection && activeConnection.providerSpecificData?.accountId) {
          targetAccountId = activeConnection.providerSpecificData.accountId;
          targetApiKey = activeConnection.apiKey;
        }
      }
    }

    if (!targetAccountId || !targetApiKey) {
      return NextResponse.json({ error: "Account ID and API Key or valid connectionId are required" }, { status: 400 });
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${targetAccountId}/ai/run/@cf/meta/llama-3.2-11b-vision-instruct`;
    
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${targetApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: "agree" }),
    });

    const data = await res.json();
    
    // Cloudflare returns success:false but logs the agreement in errors message
    const isSuccess = data?.success || (data?.errors?.[0]?.message?.includes("Thank you for agreeing") ?? false);

    if (isSuccess) {
      // Clear model locks and errors if we have the connection context
      if (activeConnection) {
        const updates = {
          testStatus: "ok",
          lastError: null,
          errorCode: null,
        };
        // Clear all modelLock keys
        Object.keys(activeConnection).forEach((key) => {
          if (key.startsWith("modelLock_")) {
            updates[key] = null;
          }
        });
        await updateProviderConnection(activeConnection.id, updates);
      }
      return NextResponse.json({ success: true, message: "Agreement accepted successfully" });
    } else {
      return NextResponse.json({ success: false, error: data?.errors?.[0]?.message || "Failed to agree" }, { status: 400 });
    }
  } catch (error) {
    console.error("Cloudflare agreement error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
