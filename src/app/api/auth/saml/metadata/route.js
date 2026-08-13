import { getSettings } from "@/lib/localDb";
import { generateSamlMetadata } from "@/lib/auth/saml";

export async function GET(request) {
  try {
    const settings = await getSettings();
    const origin = new URL(request.url).origin;
    const metadataXml = generateSamlMetadata(origin, settings);

    return new Response(metadataXml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    return new Response(`<?xml version="1.0"?><Error>${error.message || "Failed to generate metadata"}</Error>`, {
      status: 500,
      headers: {
        "Content-Type": "application/xml",
      },
    });
  }
}
