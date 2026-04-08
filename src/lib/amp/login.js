/**
 * Amp CLI Login Helper
 * Handles authentication flow with Amp API
 */

/**
 * Request Amp CLI login and get auth URL
 * @param {string} apiKey - API key to authenticate with Amp
 * @returns {Promise<{authUrl: string, verificationCode: string, expiresAt: string}>}
 */
export async function requestAmpLogin(apiKey) {
  if (!apiKey) {
    throw new Error("API key is required for Amp login");
  }

  try {
    const response = await fetch("https://ampcode.com/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        client: "9router",
        version: "0.3.35",
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error || `Amp login failed with status ${response.status}`
      );
    }

    const data = await response.json();

    // Validate response structure
    if (!data.authUrl || !data.verificationCode) {
      throw new Error("Invalid response from Amp login API");
    }

    return {
      authUrl: data.authUrl,
      verificationCode: data.verificationCode,
      expiresAt: data.expiresAt || new Date(Date.now() + 15 * 60 * 1000).toISOString(), // Default 15 minutes
    };
  } catch (error) {
    console.error("[Amp Login] Error requesting login:", error);
    throw error;
  }
}
