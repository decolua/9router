// IndexedDB-backed history of generated TTS clips.
// Audio is stored as a Blob (not base64) so large clips don't blow the
// localStorage quota and survive page reloads.

const DB_NAME = "9router-tts-history";
const STORE = "clips";
const DB_VERSION = 1;
const MAX_CLIPS = 50; // keep only the most recent N to bound storage

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
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
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

// Add a clip, then prune anything beyond MAX_CLIPS (oldest first).
export async function addTtsClip(clip) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.put(clip);
    const keysReq = store.index("createdAt").getAllKeys(); // primary keys in createdAt order (oldest first)
    keysReq.onsuccess = () => {
      const keys = keysReq.result || [];
      const excess = keys.length - MAX_CLIPS;
      for (let i = 0; i < excess; i++) store.delete(keys[i]);
    };
    tx.oncomplete = () => resolve(clip);
    tx.onerror = () => reject(tx.error);
  });
}

// All clips, newest first.
export async function listTtsClips() {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => b.createdAt - a.createdAt));
    req.onerror = () => reject(req.error);
  });
}

export async function deleteTtsClip(id) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Clear clips, optionally only for one provider.
export async function clearTtsClips(provider) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    if (!provider) {
      store.clear();
    } else {
      const req = store.getAll();
      req.onsuccess = () => {
        for (const c of req.result || []) if (c.provider === provider) store.delete(c.id);
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
