// Some models regurgitate the user's own message back as their reply — observed
// in session 7697af0e, where an abusive user line came back verbatim as
// assistant output. That is distinct from the harness-XML echo the translator
// already strips: this is the user's own prose, so there is no tag to key on.
//
// Deliberately conservative. A model quoting a line back at you is normal and
// short; wholesale regurgitation is long and starts at the beginning. Only a
// verbatim prefix of at least MIN_ECHO characters counts, so ordinary quoting
// is never touched. Getting this wrong deletes real answers, which is worse
// than the disease.

const MIN_ECHO = 120;

export function extractLastUserText(body) {
  if (!body || typeof body !== "object") return "";

  const fromContent = (content) => {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
      .map((b) => (b && typeof b === "object" && typeof b.text === "string" ? b.text : ""))
      .filter(Boolean)
      .join("\n");
  };

  const lastUserOf = (arr, roleKey = "role") => {
    if (!Array.isArray(arr)) return "";
    for (let i = arr.length - 1; i >= 0; i--) {
      const m = arr[i];
      if (!m) continue;
      const role = m[roleKey];
      if (role === "user") return fromContent(m.content ?? m.parts);
    }
    return "";
  };

  // openai / claude shapes, then responses, then gemini-style contents.
  return (
    lastUserOf(body.messages) ||
    lastUserOf(body.input) ||
    lastUserOf(body.contents) ||
    lastUserOf(body.request?.contents) ||
    ""
  );
}

function normalize(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

// True when `text` is the opening of the user's own message repeated back.
export function isUserEcho(text, lastUserText, minEcho = MIN_ECHO) {
  const out = normalize(text);
  const user = normalize(lastUserText);
  if (out.length < minEcho || user.length < minEcho) return false;
  const span = Math.min(out.length, user.length);
  return out.slice(0, span) === user.slice(0, span);
}
