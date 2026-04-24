import { generateRootCA, loadRootCA, generateLeafCert, type CertPair } from "./rootCA";

/**
 * Generate Root CA certificate (one-time setup)
 * This replaces the old static wildcard cert approach
 */
export async function generateCert(): Promise<CertPair> {
  return await generateRootCA();
}

/**
 * Get certificate for a specific domain (dynamic generation)
 * Used by SNICallback in server.js
 */
export function getCertForDomain(domain: string): CertPair | null {
  try {
    const rootCA = loadRootCA();
    const leafCert = generateLeafCert(domain, rootCA);
    return {
      key: leafCert.key,
      cert: leafCert.cert
    };
  } catch (error: any) {
    console.error(`Failed to generate cert for ${domain}:`, error.message);
    return null;
  }
}
