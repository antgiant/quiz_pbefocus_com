// Persistent cache for downloaded NKJV chapters (IndexedDB), so repeat visits
// are instant and fill-in-the-blank quizzes work offline once a chapter has
// been fetched. Every failure resolves to "not cached": the in-memory cache in
// DataService keeps working when IndexedDB is unavailable (private browsing,
// blocked storage, some file:// setups).

const DB_NAME = "pbe-quiz-verses";
const DB_VERSION = 1;
const STORE = "chapters";

export class VerseStore {
  constructor(factory = globalThis.indexedDB) {
    this.factory = factory || null;
    this.dbPromise = null;
    this.pendingReads = [];
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

  // Reads requested in the same tick (a whole season's chapters) share one transaction
  get(key) {
    return new Promise((resolve) => {
      this.pendingReads.push({ key, resolve });
      if (this.pendingReads.length === 1) {
        queueMicrotask(() => this.flushReads());
      }
    });
  }

  async flushReads() {
    const batch = this.pendingReads.splice(0);
    const db = await this.open();
    if (!db) {
      batch.forEach((item) => item.resolve(null));
      return;
    }
    try {
      const store = db.transaction(STORE, "readonly").objectStore(STORE);
      for (const item of batch) {
        const request = store.get(item.key);
        request.onsuccess = () => {
          const verses = request.result?.verses;
          item.resolve(Array.isArray(verses) && verses.length ? verses : null);
        };
        request.onerror = () => item.resolve(null);
      }
    } catch {
      batch.forEach((item) => item.resolve(null));
    }
  }

  async set(key, verses) {
    const db = await this.open();
    if (!db || !Array.isArray(verses) || !verses.length) return false;
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction(STORE, "readwrite");
        transaction.objectStore(STORE).put({ key, verses, savedAt: Date.now() });
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
        transaction.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }
}
