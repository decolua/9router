/**
 * GCP Projects Service — List, validate, and auto-detect Google Cloud projects
 * 
 * Uses the public Cloud Resource Manager v3 REST API via undici (no googleapis dependency).
 * All calls require a valid OAuth access_token from the user's Google account.
 *
 * API docs: https://cloud.google.com/resource-manager/reference/rest/v3/projects
 */

import { request } from "undici";

const GCP_API_BASE = "https://cloudresourcemanager.googleapis.com/v3";

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Generic Google API request via undici.
 * Returns parsed JSON or throws a descriptive error.
 */
async function gcpRequest({ token, path, method = "GET", body, query }) {
  let url = `${GCP_API_BASE}/${path}`;
  if (query) {
    const params = new URLSearchParams(query);
    url += `?${params.toString()}`;
  }

  const opts = {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const { statusCode, body: resBody } = await request(url, opts);
  const data = await resBody.json();

  if (statusCode >= 400) {
    const msg = data?.error?.message || `HTTP ${statusCode}`;
    const err = new Error(`GCP API error: ${msg}`);
    err.code = statusCode;
    err.gcpError = data?.error;
    throw err;
  }
  return data;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Search for all active GCP projects the user has access to.
 * @param {string} token - OAuth access token
 * @param {string} [prefix] - Optional project ID prefix filter (e.g. "9router-auto")
 * @returns {Promise<Array<{projectId: string, displayName: string, createTime: string}>>}
 */
export async function listProjects(token, prefix) {
  try {
    let query = "lifecycleState:ACTIVE";
    if (prefix) {
      query += ` id:${prefix}*`;
    }

    const data = await gcpRequest({
      token,
      path: "projects:search",
      method: "GET",
      query: { query },
    });

    return (data.projects || []).map(p => ({
      projectId: p.projectId,
      displayName: p.displayName || p.projectId,
      createTime: p.createTime,
    }));
  } catch (err) {
    // 403 = scope not granted / ToS not accepted / etc.
    // Return empty array so caller can degrade gracefully.
    console.warn("[GcpProjects] listProjects failed:", err.message);
    return [];
  }
}

/**
 * Validate that a specific project ID exists and the user has access.
 * @param {string} token
 * @param {string} projectId
 * @returns {Promise<{valid: boolean, displayName?: string, message?: string}>}
 */
export async function validateProject(token, projectId) {
  if (!projectId || typeof projectId !== "string" || !projectId.trim()) {
    return { valid: false, message: "Project ID tidak boleh kosong." };
  }
  const sanitized = projectId.trim();

  // Google project IDs: 6-30 chars, lowercase letters, digits, hyphens, must start with letter
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(sanitized)) {
    return { valid: false, message: "Format Project ID tidak valid. Harus 6-30 karakter, huruf kecil, angka, dan tanda hubung." };
  }

  try {
    const data = await gcpRequest({
      token,
      path: `projects/${sanitized}`,
      method: "GET",
    });
    return {
      valid: true,
      displayName: data.displayName || sanitized,
    };
  } catch (err) {
    if (err.code === 403) {
      return { valid: false, message: "Anda tidak memiliki akses ke project ini." };
    }
    if (err.code === 404) {
      return { valid: false, message: "Project tidak ditemukan. Pastikan ID yang dimasukkan benar." };
    }
    return { valid: false, message: `Validasi gagal: ${err.message}` };
  }
}

/**
 * Generate a Cloud Shell URL that runs `gcloud projects create` with a random name.
 * This is a 100% official Google feature — the user still authorizes inside Cloud Shell.
 *
 * @param {string} [prefix="9router-auto"] - Prefix for the auto-generated project ID
 * @returns {{url: string, projectId: string}}
 */
export function generateCloudShellUrl(prefix = "9router-auto") {
  const suffix = Math.random().toString(36).substring(2, 7);
  const projectId = `${prefix}-${suffix}`;

  // Cloud Shell "open" URL with a pre-filled terminal command
  // Docs: https://cloud.google.com/shell/docs/open-in-cloud-shell
  const command = `gcloud projects create ${projectId} --name="9Router Project" --set-as-default && echo "✅ Project berhasil dibuat! Project ID: ${projectId}"`;
  const url = `https://shell.cloud.google.com/cloudshell/open?shellonly=true&ephemeral=false&cloudshell_print=${encodeURIComponent(`Creating project ${projectId}...`)}&cloudshell_command=${encodeURIComponent(command)}`;

  return { url, projectId };
}

/**
 * Poll projects.search looking for a newly created project with a specific prefix.
 * Returns the first matching project ID or null after timeout.
 *
 * Intended to be called from the backend on behalf of a polling frontend request,
 * NOT as a long-running server-side loop.
 *
 * @param {string} token
 * @param {string} targetProjectId - The exact project ID to look for
 * @returns {Promise<string|null>}
 */
export async function checkProjectExists(token, targetProjectId) {
  try {
    const data = await gcpRequest({
      token,
      path: `projects/${targetProjectId}`,
      method: "GET",
    });
    // Project exists and user has access
    if (data.projectId) {
      return data.projectId;
    }
    return null;
  } catch {
    return null;
  }
}
