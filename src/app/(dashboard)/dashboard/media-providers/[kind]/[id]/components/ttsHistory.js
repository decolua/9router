// IndexedDB-backed history of generated TTS clips.
// Audio is stored as a Blob (not base64) so large clips don't blow the
// localStorage quota and survive page reloads.

const DB_NAME = "9router-tts-history";
const STORE = "clips";
const DB_VERSION = 2; // v2 adds the `provider` index
const MAX_CLIPS = 50;
// A count cap alone is not a storage bound: one PCM clip can be tens of MB, so
// 50 of them could claim gigabytes of the origin quota. Bound bytes too.
const MAX_BYTES = 200 * 1024 * 1024;

let dbPromise = null;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const store = db.objectStoreNames.contains(STORE)
        ? req.transaction.objectStore(STORE)
        : db.createObjectStore(STORE, { keyPath: "id" });
      // Created conditionally so a v1 database upgrades in place instead of
      // throwing ConstraintError on the index it already has.
      if (!store.indexNames.contains("createdAt")) store.createIndex("createdAt", "createdAt");
      if (!store.indexNames.contains("provider")) store.createIndex("provider", "provider");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Reuse a single connection for the page lifetime instead of reopening per call.
function getDb() {
  if (!dbPromise) dbPromise = openDb().catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
}

// One transaction lifecycle for every operation: `run` issues requests against
// the store, and if it returns one, its result becomes the resolved value.
async function withStore(mode, run) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let out;
    const req = run(tx.objectStore(STORE));
    if (req) req.onsuccess = () => { out = req.result; };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Walk newest → oldest, keeping clips until either bound is crossed; everything
// older than that point is dropped. One cursor, and audio is never deserialized
// wholesale the way a getAll() would.
function prune(store) {
  const cursorReq = store.index("createdAt").openCursor(null, "prev");
  let kept = 0;
  let bytes = 0;
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) return;
    kept += 1;
    bytes += Number(cursor.value?.size) || 0;
    if (kept > MAX_CLIPS || bytes > MAX_BYTES) cursor.delete();
    cursor.continue();
  };
}

// Add a clip, then prune anything beyond the caps (oldest first).
export function addTtsClip(clip) {
  return withStore("readwrite", (store) => {
    store.put(clip);
    prune(store);
  }).then(() => clip);
}

// Clips for one provider (or all when omitted), newest first.
export function listTtsClips(provider) {
  return withStore("readonly", (store) =>
    provider ? store.index("provider").getAll(provider) : store.getAll()
  ).then((clips) => (clips || []).sort((a, b) => b.createdAt - a.createdAt));
}

export function deleteTtsClip(id) {
  return withStore("readwrite", (store) => { store.delete(id); });
}

// Clear clips, optionally only for one provider.
export function clearTtsClips(provider) {
  return withStore("readwrite", (store) => {
    if (!provider) {
      store.clear();
      return;
    }
    // Keys only — deleting a subset must not deserialize every stored blob.
    const keysReq = store.index("provider").getAllKeys(provider);
    keysReq.onsuccess = () => {
      for (const key of keysReq.result || []) store.delete(key);
    };
  });
}
