import { NextResponse } from "next/server";
import { getProviderConnections } from "@/models";
import { checkDuplicate } from "@/shared/utils/duplicateDetection";

/**
 * POST /api/providers/check-duplicate
 * Check if a connection would be a duplicate
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { provider, authType, email, apiKey, projectId, providerSpecificData } = body;

    if (!provider || !authType) {
      return NextResponse.json(
        { error: "Provider and authType are required" },
        { status: 400 }
      );
    }

    // Get existing connections for this provider
    const existingConnections = await getProviderConnections({ provider });

    // Create a temporary connection object for comparison
    const tempConnection = {
      provider,
      authType,
      email,
      apiKey,
      projectId,
      providerSpecificData,
    };

    // Check for duplicates
    const result = checkDuplicate(tempConnection, existingConnections);

    if (result.isDuplicate) {
      return NextResponse.json({
        isDuplicate: true,
        duplicate: {
          id: result.duplicate.id,
          name: result.duplicate.name,
          email: result.duplicate.email,
          priority: result.duplicate.priority,
          isActive: result.duplicate.isActive,
          createdAt: result.duplicate.createdAt,
        },
        reason: result.reason,
      });
    }

    return NextResponse.json({ isDuplicate: false });
  } catch (error) {
    console.error("Error checking duplicate:", error);
    return NextResponse.json(
      { error: "Failed to check duplicate" },
      { status: 500 }
    );
  }
}