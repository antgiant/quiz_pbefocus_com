// Persistent cache for season packs (IndexedDB), so repeat visits skip the
// download and the JSON parse of a season's questions. One record per season:
// saving a new pack version replaces the old one, so the store never grows.
// Every failure resolves to "not cached" (private browsing, blocked storage).

import { withTimeout } from "./utils.js";

const DB_NAME = "pbe-quiz-packs";
// A stuck open (seen on iOS) is treated as "nothing saved" instead of freezing startup
const DB_OPEN_TIMEOUT_MS = 3000;
const DB_READ_TIMEOUT_MS = 4000;
const DB_VERSION = 1;
const STORE = "packs";

export class PackStore {
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
              request.result.createObjectStore(STORE, { keyPath: "yearId" });
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

  // Resolves the stored pack only when it is the expected version
  async get(yearId, hash) {
    const db = await this.open();
    if (!db) return null;
    return withTimeout(new Promise((resolve) => {
      try {
        const request = db.transaction(STORE, "readonly").objectStore(STORE).get(yearId);
        request.onsuccess = () => {
          const record = request.result;
          if (!record || record.hash !== hash) {
            resolve(null);
            return;
          }
          // Stored as text: one JSON.parse is much cheaper than rebuilding thousands of
          // small objects from IndexedDB's structured clone
          try {
            resolve(record.json ? JSON.parse(record.json) : null);
          } catch {
            resolve(null);
          }
        };
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    }), DB_READ_TIMEOUT_MS, null);
  }

  async set(yearId, hash, pack) {
    const db = await this.open();
    if (!db || !pack) return false;
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction(STORE, "readwrite");
        transaction.objectStore(STORE).put({ yearId, hash, json: JSON.stringify(pack), savedAt: Date.now() });
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
        transaction.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }
}
