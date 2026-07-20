import { getSettings } from "../../lib/localDb.js";

class TempMailError extends Error {
  constructor(message, status = 0, body = "") {
    super(message);
    this.name = "TempMailError";
    this.status = status;
    this.body = body;
  }
}

export class TempMailClient {
  constructor(baseUrl, apiKey, defaultDomain = "", fallbackUrl = "", timeout = 20000) {
    this.baseUrl = (baseUrl || "").trim().replace(/\/+$/, "");
    if (this.baseUrl && !/^https?:\/\//i.test(this.baseUrl)) {
      this.baseUrl = `https://${this.baseUrl}`;
    }
    this.fallbackUrl = (fallbackUrl || "").trim().replace(/\/+$/, "");
    if (this.fallbackUrl && !/^https?:\/\//i.test(this.fallbackUrl)) {
      this.fallbackUrl = `https://${this.fallbackUrl}`;
    }
    this.apiKey = (apiKey || "").trim();
    this.defaultDomain = (defaultDomain || "").trim().toLowerCase();
    this.timeout = timeout;
  }

  get configured() {
    return !!this.baseUrl && !!this.apiKey;
  }

  async _request(method, path, body = null) {
    if (!this.configured) {
      throw new TempMailError("ammail_not_configured");
    }

    try {
      return await this._executeRequest(this.baseUrl, method, path, body);
    } catch (e) {
      if (this.fallbackUrl && this.fallbackUrl !== this.baseUrl) {
        try {
          console.warn(`Ammail Client: Primary URL ${this.baseUrl} failed, retrying with fallback URL ${this.fallbackUrl}:`, e.message);
          return await this._executeRequest(this.fallbackUrl, method, path, body);
        } catch (fallbackErr) {
          throw fallbackErr;
        }
      }
      throw e;
    }
  }

  async _executeRequest(baseUrl, method, path, body = null) {
    const url = `${baseUrl}${path}`;
    const headers = {
      "X-API-Key": this.apiKey,
      "Accept": "application/json",
    };

    if (body !== null) {
      headers["Content-Type"] = "application/json";
    }

    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), this.timeout);

      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : null,
        signal: controller.signal,
      });
      clearTimeout(id);

      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch (e) {
        data = { raw: text.substring(0, 1000) };
      }

      if (res.status >= 400) {
        const errMsg = data.error || `http_${res.status}`;
        throw new TempMailError(errMsg, res.status, text.substring(0, 1000));
      }

      return data;
    } catch (e) {
      if (e instanceof TempMailError) throw e;
      throw new TempMailError(`network_error: ${e.message}`);
    }
  }

  async health() {
    return this._request("GET", "/api/health");
  }

  async info() {
    return this._request("GET", "/api");
  }

  async createInbox(alias = null, domain = null) {
    const body = {};
    if (alias) body.alias = alias;
    const targetDomain = (domain || this.defaultDomain || "").trim().toLowerCase();
    if (targetDomain) body.domain = targetDomain;
    return this._request("POST", "/api/inboxes", body);
  }

  async listInboxes() {
    const data = await this._request("GET", "/api/inboxes");
    return data.inboxes || [];
  }

  async deleteInbox(alias) {
    const data = await this._request("DELETE", `/api/inboxes/${alias.trim().toLowerCase()}`);
    return !!data.deleted;
  }

  async listMessages(alias) {
    const data = await this._request("GET", `/api/inboxes/${alias.trim().toLowerCase()}/messages`);
    return data.messages || [];
  }

  async getMessage(messageId) {
    const data = await this._request("GET", `/api/messages/${messageId.trim()}`);
    return data.message || {};
  }

  async getWebhook() {
    const data = await this._request("GET", "/api/webhook");
    return data.webhook || null;
  }

  async setWebhook(url, secret = null) {
    const body = { url };
    if (secret !== null) body.secret = secret;
    const data = await this._request("PUT", "/api/webhook", body);
    return data.webhook || {};
  }

  async testWebhook() {
    return this._request("POST", "/api/webhook/test");
  }

  async deleteWebhook() {
    const data = await this._request("DELETE", "/api/webhook");
    return !!data.deleted;
  }
}

export async function getAmmailClientFromSettings(timeout = 20000) {
  const settings = await getSettings();
  return new TempMailClient(
    settings.ammail_base_url || "",
    settings.ammail_api_key || "",
    settings.ammail_default_domain || "",
    settings.ammail_cf_workers_dev_url || "",
    timeout
  );
}

// --- OTP Extraction Helper ---

const LABELED_CODE = /(?:verification\s*code|verify\s*code|security\s*code|one[-\s]?time\s*(?:password|code|pin)|\bOTP\b|\bPIN\b|\bcode\s*(?:is|:)|\bcode\b)\s*[:#-]?\s*([0-9]{4,8})\b/i;
const LOOSE_DIGITS = /(?<![0-9])([0-9]{4,8})(?![0-9])/;
const VERIFY_URL_KEYS = /\bhttps?:\/\/[^\s<>"']+(?:verify|confirm|activate|validate|signup|register|email)[^\s<>"']*/i;
const FIRST_URL = /\bhttps?:\/\/[^\s<>"']+/i;

function stripHtml(html) {
  if (!html) return "";
  let text = html.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');
  return text.replace(/\s+/g, " ").trim();
}

export function extractOtp(text, html = "", subject = "") {
  const parts = [subject || "", text || "", stripHtml(html || "")];
  const haystack = parts.filter(Boolean).join("\n");

  let code = "";
  let labeled = LABELED_CODE.exec(haystack);
  if (labeled) {
    code = labeled[1];
  } else {
    let loose = LOOSE_DIGITS.exec(haystack);
    if (loose) {
      code = loose[1];
    }
  }

  const urlParts = [subject || "", text || "", html || ""];
  let urlHaystack = urlParts.filter(Boolean).join("\n");

  // Decode quoted-printable soft linebreaks and hex characters
  urlHaystack = urlHaystack.replace(/=\r?\n/g, "");
  urlHaystack = urlHaystack.replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  let verifyUrl = "";
  let m;
  const verifyRegex = new RegExp(VERIFY_URL_KEYS, "gi");
  while ((m = verifyRegex.exec(urlHaystack)) !== null) {
    const url = m[0];
    const urlLower = url.toLowerCase();
    if (!urlLower.includes("w3.org") && !urlLower.includes("xml") && !/\.(dtd|xsd|woff|woff2|png|jpg|jpeg|gif|css|js)$/.test(urlLower)) {
      if (!urlLower.includes("utm_content=logo") && !urlLower.includes("help.figma.com") && !urlLower.includes("static.figma.com") && !urlLower.includes("x.com") && !urlLower.includes("instagram.com") && !urlLower.includes("youtube.com") && !urlLower.includes("linkedin.com")) {
        verifyUrl = url;
        break;
      }
    }
  }

  if (!verifyUrl) {
    const firstUrlRegex = new RegExp(FIRST_URL, "gi");
    while ((m = firstUrlRegex.exec(urlHaystack)) !== null) {
      const url = m[0];
      const urlLower = url.toLowerCase();
      if (!urlLower.includes("w3.org") && !urlLower.includes("xml") && !/\.(dtd|xsd|woff|woff2|png|jpg|jpeg|gif|css|js)$/.test(urlLower) && !urlLower.includes("schemas.xmlsoap.org")) {
        if (!urlLower.includes("utm_content=logo") && !urlLower.includes("help.figma.com") && !urlLower.includes("static.figma.com") && !urlLower.includes("x.com") && !urlLower.includes("instagram.com") && !urlLower.includes("youtube.com") && !urlLower.includes("linkedin.com")) {
          verifyUrl = url;
          break;
        }
      }
    }
  }

  if (verifyUrl) {
    verifyUrl = verifyUrl.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }

  return { code, verifyUrl };
}
