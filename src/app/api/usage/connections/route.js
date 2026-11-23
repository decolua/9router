import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/db/index.js";

/**
 * GET /api/usage/connections?provider=<providerId>
 * Returns the active provider connections used to label each request detail row.
 *
 * The usage "Details" tab stores `connectionId` per request, which identifies the
 * exact credential row that served the request — not just the provider. Two
 * accounts under the same provider (e.g. two Claude logins) therefore get
 * distinct ids and can be filtered apart; that is the whole point of the
 * account filter, so the UI needs this list to turn ids into readable emails.
 *
 * Security: this endpoint is deliberately narrow. It projects ONLY
 * { id, provider, name } and never spreads the repo result, because
 * getProviderConnections() also returns accessToken, refreshToken, apiKey,
 * idToken and providerSpecificData. Returning those would leak live
 * credentials to any dashboard user just to render a dropdown.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");

    const filter = { isActive: true };
    // Scope to the provider currently selected in the UI so the list stays
    // short and consistent with the rows the table can actually show.
    if (provider) filter.provider = provider;

    const connections = await getProviderConnections(filter);

    // Re-check isActive here instead of trusting the SQL filter alone: an
    // inactive row would offer an account that cannot appear in the table
    // (and whose requests would filter to nothing), so the dropdown must not
    // show it even if the repo layer's filtering ever regresses.
    const options = (connections || []).filter((connection) => connection?.isActive !== false).map((connection) => ({
      id: connection.id,
      provider: connection.provider,
      // `name` holds the email for OAuth rows and the user label for API-key
      // rows; fall back to that email column when an older row left name empty
      // so the dropdown never renders a blank account.
      name: connection.name || connection.email || "",
    }));

    return NextResponse.json({ connections: options });
  } catch (error) {
    console.error("[API] Failed to get usage connections:", error);
    return NextResponse.json(
      { error: "Failed to fetch connections" },
      { status: 500 }
    );
  }
}
