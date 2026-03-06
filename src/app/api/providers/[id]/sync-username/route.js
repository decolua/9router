import { NextResponse } from "next/server";
import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";

/**
 * POST /api/providers/[id]/sync-username
 * Syncs the GitHub username from the API and updates the account name
 */
export async function POST(request, { params }) {
  try {
    // In Next.js 15+, params might be a Promise
    const resolvedParams = await Promise.resolve(params);
    const { id } = resolvedParams;

    // Get the provider connection
    const connection = await getProviderConnectionById(id);
    
    if (!connection) {
      return NextResponse.json(
        { error: "Provider connection not found" },
        { status: 404 }
      );
    }

    // Only support GitHub provider
    if (connection.provider !== "github") {
      return NextResponse.json(
        { error: "Sync username is only supported for GitHub provider" },
        { status: 400 }
      );
    }

    // Check if we have an access token
    const token = connection.accessToken;
    if (!token) {
      return NextResponse.json(
        { error: "No access token found for this account" },
        { status: 400 }
      );
    }

    // Fetch username from GitHub API
    try {
      const response = await fetch("https://api.github.com/user", {
        headers: {
          "Authorization": `token ${token}`,
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "9router"
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          return NextResponse.json(
            { error: "Invalid or expired token" },
            { status: 401 }
          );
        }
        throw new Error(`GitHub API returned ${response.status}`);
      }

      const userData = await response.json();
      const username = userData.login;

      if (!username) {
        return NextResponse.json(
          { error: "Could not retrieve username from GitHub" },
          { status: 500 }
        );
      }

      // Update the connection with the new name
      const updatedConnection = await updateProviderConnection(id, {
        name: username,
        displayName: userData.name || username,
        email: userData.email || connection.email
      });

      return NextResponse.json({
        success: true,
        username: username,
        connection: updatedConnection
      });

    } catch (error) {
      console.error("Error fetching GitHub user data:", error);
      return NextResponse.json(
        { error: "Failed to fetch user data from GitHub" },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error("Error syncing username:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}