// DOM selectors and in-page scripts for the muse.ai web client.
//
// All knowledge about the page structure lives here. When muse.ai ships a UI
// change, this is normally the only file that needs updating. Scripts return
// JSON-serialisable values and never throw (errors are reported in the payload).

const INPUT = "textarea";
const AGENT_BUBBLE = 'div[class*="hatch-agent-bubble-bg"]';
const ATTACHMENT = '[data-testid^="hatch-chat-attachment-presentation-"]';
const STOP_BUTTON = 'button[aria-label*="Stop" i]';
// The agent asks before acting on the user's behalf (e.g. uploading the result
// to muse.ai/files as a public link). Nobody answers it here, so it would block
// for minutes.
const APPROVAL_CARD = '[data-testid="hatch-inline-approval-card"]';
const FILE_INPUT = 'input[type="file"]';

const LOGIN_HINTS = ["log in", "sign in", "create an account", "use another account"];
const QUOTA_HINTS = ["out of credits", "usage limit", "limit reached", "token limit"];
const STALL_HINTS = ["Still sending", "Connecting..."];

/** JSON-quote a JS string for safe interpolation into an in-page script. */
function q(value) {
  return JSON.stringify(value);
}

export {
  INPUT,
  AGENT_BUBBLE,
  ATTACHMENT,
  STOP_BUTTON,
  APPROVAL_CARD,
  FILE_INPUT,
  LOGIN_HINTS,
  QUOTA_HINTS,
  STALL_HINTS,
};

export const PAGE_STATE = `(() => {
  const body = document.body ? document.body.innerText : '';
  const hydration = document.querySelector('[data-hatch-shell-hydration-state]');
  return {
    ready: document.readyState === 'complete' && !!document.querySelector(${q(INPUT)})
           && (!hydration || hydration.getAttribute('data-hatch-shell-hydration-state') === 'hydrated')
           && !body.includes('Connecting...'),
    hasInput: !!document.querySelector(${q(INPUT)}),
    path: location.pathname,
    head: body.slice(0, 800),
  };
})()`;

// Snapshot of the conversation used to detect new output after sending.
export const CHAT_STATE = `(() => {
  const scrollers = [...document.querySelectorAll('*')].filter(e => {
    const s = getComputedStyle(e);
    return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 50;
  });
  scrollers.forEach(e => { e.scrollTop = e.scrollHeight; });
  const bubbles = [...document.querySelectorAll(${q(AGENT_BUBBLE)})];
  const last = bubbles.length ? (bubbles[bubbles.length - 1].innerText || '').trim() : '';
  const atts = [...document.querySelectorAll(${q(ATTACHMENT)})].map(a => {
    const v = a.querySelector('video'), i = a.querySelector('img');
    const m = v || i;
    return {
      tid: a.getAttribute('data-testid') || '',
      kind: v ? 'video' : (i ? 'image' : 'unknown'),
      src: m ? (m.currentSrc || m.src || '') : '',
      w: m ? (m.videoWidth || m.naturalWidth || 0) : 0,
      h: m ? (m.videoHeight || m.naturalHeight || 0) : 0,
    };
  });
  const tail = document.body ? document.body.innerText.slice(-600) : '';
  return { agentCount: bubbles.length, lastText: last,
            generating: !!document.querySelector(${q(STOP_BUTTON)}),
            approval: !!document.querySelector(${q(APPROVAL_CARD)}),
            attachments: atts, tail };
})()`;

// Click "Deny" on every pending approval card; the agent then carries on without
// the action (and the result stays private instead of becoming a public link).
export const DENY_APPROVALS = `(() => {
  const denied = [];
  for (const card of document.querySelectorAll(${q(APPROVAL_CARD)})) {
    const btn = [...card.querySelectorAll('button,[role=button]')]
      .find(b => /^(deny|decline|reject|don.t allow)$/i.test((b.innerText || '').trim()));
    if (btn && !btn.disabled) {
      btn.click();
      denied.push(card.getAttribute('aria-label') || 'approval request');
    }
  }
  return denied;
})()`;

// Media links that the assistant delivered as a text bubble / anchor / <video>
// element rather than as an inline attachment presentation. Scans the last agent
// bubble for every candidate URL (anchor hrefs, media element srcs incl. blob:,
// and bare URLs in the text) and returns the bubble HTML for diagnostics.
export const LAST_BUBBLE_MEDIA = `(() => {
  const bubbles = [...document.querySelectorAll(${q(AGENT_BUBBLE)})];
  const b = bubbles.length ? bubbles[bubbles.length - 1] : null;
  if (!b) return { links: [], html: '' };
  const urls = [];
  const push = (u) => { if (u && !urls.includes(u)) urls.push(u); };
  b.querySelectorAll('video, source').forEach(m => push(m.currentSrc || m.src || ''));
  b.querySelectorAll('a[href]').forEach(a => push(a.href || ''));
  b.querySelectorAll('img').forEach(m => push(m.currentSrc || m.src || ''));
  const text = b.innerText || '';
  const re = /https?:\\/\\/[^\\s)<>"']+/g;
  let mm; while ((mm = re.exec(text))) push(mm[0]);
  return { links: urls, html: (b.outerHTML || '').slice(0, 2000) };
})()`;

export function fillInputScript(text) {
  // Set the textarea value through the native setter so React picks it up.
  return `(() => {
  const ta = document.querySelector(${q(INPUT)});
  if (!ta) return { ok: false, err: 'no-input' };
  ta.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, ${q(text)});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return { ok: true, len: ta.value.length };
})()`;
}

export const CLICK_SEND = `(() => {
  const btn = [...document.querySelectorAll('button,[role=button]')]
    .filter(b => b.offsetParent !== null)
    .find(b => /send|发送/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('data-testid') || '')));
  if (!btn) return 'missing';
  if (btn.disabled) return 'disabled';
  btn.click();
  return 'clicked';
})()`;

export const INPUT_EMPTY = `!(document.querySelector(${q(INPUT)}) || { value: '' }).value`;

export function attachFileScript(b64, mime, filename) {
  return `(() => {
  try {
    const input = document.querySelector(${q(FILE_INPUT)});
    if (!input) return { ok: false, err: 'no-file-input' };
    const bin = atob(${q(b64)});
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], ${q(filename)}, { type: ${q(mime)} }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  } catch (e) { return { ok: false, err: String(e) }; }
})()`;
}

export function fetchAsBase64Script(url) {
  // Fetch a (possibly blob:) URL inside the page context and return base64 bytes.
  return `(async () => {
  try {
    const r = await fetch(${q(url)});
    const b = await r.blob();
    const buf = new Uint8Array(await b.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { ok: true, mime: b.type || '', b64: btoa(s) };
  } catch (e) { return { ok: false, err: String(e) }; }
})()`;
}
