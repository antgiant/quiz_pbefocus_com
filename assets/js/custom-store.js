// The person's own questions, saved on this device (IndexedDB). Unlike the downloaded verse and
// season caches these are the person's own work, so resetting the app cache must not delete them.
// Every failure resolves to "nothing saved" (private browsing, blocked storage).

import { withTimeout } from "./utils.js";

export const CUSTOM_DB_NAME = "pbe-quiz-custom";
const DB_OPEN_TIMEOUT_MS = 3000;
const DB_READ_TIMEOUT_MS = 4000;
const DB_VERSION = 1;
const STORE = "custom";
const KEY = "questions";

export class CustomStore {
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
          const request = this.factory.open(CUSTOM_DB_NAME, DB_VERSION);
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
          request.onsuccess = () => resolve(Array.isArray(request.result?.questions) ? request.result.questions : []);
          request.onerror = () => resolve([]);
        } catch {
          resolve([]);
        }
      }),
      DB_READ_TIMEOUT_MS,
      []
    );
  }

  // Resolves false when nothing could be saved, so the page can say so
  async set(questions) {
    const db = await this.open();
    if (!db || !Array.isArray(questions)) return false;
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction(STORE, "readwrite");
        transaction.objectStore(STORE).put({ key: KEY, questions, savedAt: Date.now() });
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
        transaction.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }
}
