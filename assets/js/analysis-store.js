// Persistent copy of the verse term analysis (IndexedDB), so tagging a verse once
// is enough: later visits blank verses without loading the NLP library at all.
// Every failure resolves to "nothing saved" (private browsing, blocked storage).

import { withTimeout } from "./utils.js";

const DB_NAME = "pbe-quiz-analysis";
// A stuck open (seen on iOS) is treated as "nothing saved" instead of freezing startup
const DB_OPEN_TIMEOUT_MS = 3000;
const DB_READ_TIMEOUT_MS = 4000;
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
      this.dbPromise = withTimeout(new Promise((resolve) => {
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
      }), DB_OPEN_TIMEOUT_MS, null);
    }
    return this.dbPromise;
  }

  async get() {
    const db = await this.open();
    if (!db) return [];
    return withTimeout(
      new Promise((resolve) => {
        try {
          const request = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
          request.onsuccess = () => resolve(Array.isArray(request.result?.entries) ? request.result.entries : []);
          request.onerror = () => resolve([]);
        } catch {
          resolve([]);
        }
      }),
      DB_READ_TIMEOUT_MS,
      []
    );
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
