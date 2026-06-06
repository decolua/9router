const BLOCKED_TAGS = new Set([
  "base", "button", "embed", "form", "iframe", "input", "link", "math",
  "meta", "object", "script", "select", "style", "svg", "textarea",
]);

const URI_ATTRS = new Set(["action", "formaction", "href", "src", "xlink:href"]);

function isUnsafeUri(value) {
  const normalized = String(value || "").trim().replace(/[\u0000-\u001f\u007f\s]+/g, "").toLowerCase();
  if (normalized.startsWith("javascript:")) return true;
  if (!normalized.startsWith("data:")) return false;
  const safe = ["data:image/png", "data:image/jpeg", "data:image/gif", "data:image/webp", "data:image/avif"];
  return !safe.some((p) => normalized.startsWith(p + ";") || normalized.startsWith(p + ","));
}

function fallbackSanitize(html) {
  return String(html || "")
    .replace(/<(script|style|iframe|object|embed|svg|math)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?(?:base|button|embed|form|iframe|input|link|math|meta|object|script|select|style|svg|textarea)\b[^>]*>/gi, "")
    .replace(/\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(style|srcdoc)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+([a-z0-9:_-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (match, rawName, rawValue) => {
      const name = String(rawName || "").toLowerCase();
      if (!URI_ATTRS.has(name)) return match;
      const value = String(rawValue || "").replace(/^['"]|['"]$/g, "");
      return isUnsafeUri(value) ? "" : match;
    });
}

export function sanitizeHtml(html) {
  if (!html) return "";
  if (typeof DOMParser === "undefined") return fallbackSanitize(html);

  const doc = new DOMParser().parseFromString(String(html), "text/html");
  for (const el of [...doc.body.querySelectorAll("*")]) {
    if (BLOCKED_TAGS.has(el.tagName.toLowerCase())) {
      el.remove();
      continue;
    }

    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "style" || name === "srcdoc" || (URI_ATTRS.has(name) && isUnsafeUri(attr.value))) {
        el.removeAttribute(attr.name);
      }
    }

    if (el.tagName.toLowerCase() === "a" && el.getAttribute("target") === "_blank") {
      el.setAttribute("rel", "noopener noreferrer");
    }
  }

  return doc.body.innerHTML;
}
