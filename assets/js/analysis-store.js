// Persistent copy of the verse term analysis (IndexedDB), so tagging a verse once
// is enough: later visits blank verses without loading the NLP library at all.
// Every failure resolves to "nothing saved" (private browsing, blocked storage).

const DB_NAME = "pbe-quiz-analysis";
const DB_VERSION = 1;
const STORE = "analysis";
const KEY = "terms";

export class AnalysisStore {
  constructor(factory = globalThis.indexedDB) {
    this.factory = factory || null;
    this.dbPromise = null;
  }

  open() {
    if (!this.factory) {
      return Promise.resolve(null);
    }
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve) => {
        try {
          const request = this.factory.open(DB_NAME, DB_VERSION);
          request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(STORE)) {
              request.result.createObjectStore(STORE, { keyPath: "key" });
            }
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
          request.onblocked = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    }
    return this.dbPromise;
  }

  async get() {
    const db = await this.open();
    if (!db) return [];
    return new Promise((resolve) => {
      try {
        const request = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
        request.onsuccess = () => resolve(Array.isArray(request.result?.entries) ? request.result.entries : []);
        request.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  async set(entries) {
    const db = await this.open();
    if (!db || !Array.isArray(entries)) return false;
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction(STORE, "readwrite");
        transaction.objectStore(STORE).put({ key: KEY, entries, savedAt: Date.now() });
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
        transaction.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }
}
