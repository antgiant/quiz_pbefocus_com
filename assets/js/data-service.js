import { QUESTION_DIFFICULTIES, QUESTION_TYPES } from "./constants.js";
import { PackStore } from "./pack-store.js";
import { VerseStore } from "./verse-store.js";

export const CUSTOM_YEAR_ID = "custom-all";
const MANIFEST_PATH = "questions/v1/manifest.json";
const CHAPTER_BASE_PATH = "questions/v1";
const YEARS_PATH = "questions/v1/years.json";
const PRACTICE_YEARS_PATH = "questions/v1/practice-chapters-by-year.json";
const PRACTICE_BOOKS_PATH = "questions/v1/practice-books.json";
const PACK_INDEX_PATH = "questions/v1/packs/index.json";
const LOCAL_BUNDLE_PATH = "questions/v1/local-data.bundle.js";
const NKJV_CHAPTER_API_BASE = "https://bolls.life/get-text/NKJV";
const NKJV_VERSE_API_BASE = "https://bolls.life/get-verse/NKJV";

function getLocalBundle() {
  return window.PBE_LOCAL_DATA || null;
}

function getPracticeYearsBundle() {
  return window.PBE_PRACTICE_YEARS || null;
}

function getPracticeBooksBundle() {
  return window.PBE_PRACTICE_BOOKS || null;
}

function chapterCacheKey(bookId, chapterNumber) {
  return `${bookId}:${chapterNumber}`;
}

function verseCacheKey(bookId, chapterNumber, verseNumber) {
  return `${bookId}:${chapterNumber}:${verseNumber}`;
}

function chapterRequestKey(bookId, chapterNumber) {
  return `chapter:${chapterCacheKey(bookId, chapterNumber)}`;
}

function verseRequestKey(bookId, chapterNumber, verseNumber) {
  return `verse:${verseCacheKey(bookId, chapterNumber, verseNumber)}`;
}

function extractNumericBookId(bookId) {
  const numeric = Number(String(bookId || "").split("-")[0]);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function parseNkjvVerses(data) {
  if (!data) {
    return [];
  }

  const normalizeEntry = (entry) => ({
    verse: Number(entry?.verse || entry?.verse_nr || entry?.nr),
    text: entry?.text || entry?.text_nr || entry?.text_clean || entry?.content || "",
  });

  if (Array.isArray(data)) {
    return data
      .map(normalizeEntry)
      .filter((verse) => Number.isFinite(verse.verse) && Boolean(verse.text));
  }

  if (Array.isArray(data.verses)) {
    return data.verses
      .map(normalizeEntry)
      .filter((verse) => Number.isFinite(verse.verse) && Boolean(verse.text));
  }

  if (data.verses && typeof data.verses === "object") {
    return Object.entries(data.verses)
      .map(([key, value]) => ({
        verse: Number(key),
        text: typeof value === "string" ? value : value?.text || "",
      }))
      .filter((verse) => Number.isFinite(verse.verse) && Boolean(verse.text));
  }

  if (typeof data === "object") {
    const verseNumber = Number(data.verse_nr ?? data.nr ?? data.verse);
    const verseText =
      data.text ||
      data.text_nr ||
      data.text_clean ||
      data.content ||
      (typeof data.verse === "string" && !/^\d+$/.test(data.verse) ? data.verse : "");

    if (Number.isFinite(verseNumber) && verseText) {
      return [{ verse: verseNumber, text: verseText }];
    }
  }

  return [];
}

function normalizeBookKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function scopeChapterCount(scope) {
  return Object.values(scope || {}).reduce((sum, chapters) => {
    if (!Array.isArray(chapters)) {
      return sum;
    }
    return sum + chapters.length;
  }, 0);
}

function fallbackDifficultyFromPoints(points) {
  if (points === 1) {
    return "easy";
  }

  if (points === 2) {
    return "medium";
  }

  if (points === 5) {
    return "hard";
  }

  return null;
}

function normalizeDifficulty(question) {
  const difficulty = String(question.difficulty || "").toLowerCase();
  if (QUESTION_DIFFICULTIES.includes(difficulty)) {
    return difficulty;
  }

  return fallbackDifficultyFromPoints(Number(question.points));
}

function normalizeQuestion(question, bookId, chapterJson) {
  const createdBy = question.createdBy ?? "";

  return {
    ...question,
    createdBy,
    bookId,
    book: chapterJson.book,
    chapter: chapterJson.chapter,
    startVerse: question.ref?.startVerse,
    endVerse: question.ref?.endVerse,
    type: QUESTION_TYPES.includes(question.type) ? question.type : "other",
    difficulty: normalizeDifficulty(question),
  };
}

// Intro commentary becomes "chapter 0": one passage per paragraph, labelled
// with its section title (and part number when a section has several parts)
export function buildIntroVerses(commentary) {
  const verses = [];
  for (const section of commentary || []) {
    const parts = Array.isArray(section?.parts) ? section.parts : [];
    parts.forEach((part, index) => {
      const title = section.title || "Intro";
      verses.push({
        verse: verses.length + 1,
        // The section title is in the reference label, so keep it out of the blanked text
        text: part,
        label: parts.length > 1 ? `${title} (Part ${index + 1}/${parts.length})` : title,
      });
    });
  }
  return verses;
}

// Seasons are named "2026-2027" and start in July, so in October 2026 the current
// season is 2026-2027 and in March 2027 it still is.
const SEASON_START_MONTH = 6;

export function currentSeasonStart(now = new Date()) {
  return now.getMonth() >= SEASON_START_MONTH ? now.getFullYear() : now.getFullYear() - 1;
}

// The season to open on: the current one, else the latest earlier season that has
// chapters, else the first in the list
export function pickDefaultYear(years, now = new Date()) {
  const start = currentSeasonStart(now);
  const seasons = (years || [])
    .map((year) => ({ year, start: Number(/^(\d{4})-\d{4}$/.exec(String(year.name))?.[1]) }))
    .filter((season) => Number.isInteger(season.start) && Object.keys(season.year.scope || {}).length > 0);

  const exact = seasons.find((season) => season.start === start);
  if (exact) {
    return exact.year;
  }
  const earlier = seasons.filter((season) => season.start < start).sort((a, b) => b.start - a.start)[0];
  return earlier?.year || years?.[0] || null;
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.append(script);
  });
}

export class DataService {
  constructor({ store = new VerseStore(), packStore = new PackStore() } = {}) {
    this.store = store;
    this.packStore = packStore;
    this.jsonRequests = new Map();
    this.packRequests = new Map();
    this.chapterHashes = new Map();
    this.introByBookId = new Map();
    this.manifest = null;
    this.chapterCache = new Map();
    this.nkjvChapterCache = new Map();
    this.nkjvVerseCache = new Map();
    this.nkjvInFlight = new Map();
    this.customByChapter = new Map();
    this.customWithoutChapter = [];
  }

  // The person's own questions (custom-questions.js), added to the chapters they belong to.
  // Those with no book and chapter can't be placed in a chapter; they come from
  // looseCustomQuestions() instead.
  setCustomQuestions(questions) {
    this.customByChapter = new Map();
    this.customWithoutChapter = [];
    for (const question of questions || []) {
      if (question.bookId && Number.isInteger(question.chapter)) {
        const key = chapterCacheKey(question.bookId, question.chapter);
        this.customByChapter.set(key, [...(this.customByChapter.get(key) || []), question]);
      } else {
        this.customWithoutChapter.push(question);
      }
    }
  }

  looseCustomQuestions() {
    return this.customWithoutChapter;
  }

  hasIntro(bookId) {
    return this.introByBookId.has(bookId);
  }

  bookName(bookId) {
    return this.manifest?.books?.find((book) => book.id === bookId)?.name || String(bookId);
  }

  // The Bible API can drop requests, so retry before giving up (empty result)
  async loadNkjvChapterWithRetry(bookId, chapterNumber, attempts = 3) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const verses = await this.loadNkjvChapter(bookId, chapterNumber);
        if (verses.length) return verses;
      } catch {
        // retry below
      }
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
    return [];
  }

  async loadNkjvChapter(bookId, chapterNumber) {
    const chapterKey = chapterCacheKey(bookId, chapterNumber);
    if (this.nkjvChapterCache.has(chapterKey)) {
      return this.nkjvChapterCache.get(chapterKey);
    }

    if (Number(chapterNumber) === 0) {
      const verses = buildIntroVerses(this.introByBookId.get(bookId));
      this.nkjvChapterCache.set(chapterKey, verses);
      return verses;
    }

    const numericBookId = extractNumericBookId(bookId);
    if (!numericBookId) {
      return [];
    }

    const requestKey = chapterRequestKey(bookId, chapterNumber);
    if (this.nkjvInFlight.has(requestKey)) {
      return this.nkjvInFlight.get(requestKey);
    }

    const request = this.store
      .get(chapterKey)
      .then(async (cached) => {
        if (cached) {
          return cached;
        }
        const response = await fetch(`${NKJV_CHAPTER_API_BASE}/${numericBookId}/${chapterNumber}/`);
        if (!response.ok) {
          throw new Error(`Failed to load NKJV chapter ${bookId} ${chapterNumber}: ${response.status}`);
        }
        const fetched = parseNkjvVerses(await response.json());
        this.store.set(chapterKey, fetched);
        return fetched;
      })
      .then((verses) => {
        this.nkjvChapterCache.set(chapterKey, verses);

        for (const verse of verses) {
          this.nkjvVerseCache.set(
            verseCacheKey(bookId, chapterNumber, verse.verse),
            { verse: verse.verse, text: verse.text }
          );
        }

        return verses;
      })
      .finally(() => {
        this.nkjvInFlight.delete(requestKey);
      });

    this.nkjvInFlight.set(requestKey, request);
    return request;
  }

  async loadNkjvVerse(bookId, chapterNumber, verseNumber) {
    const key = verseCacheKey(bookId, chapterNumber, verseNumber);
    if (this.nkjvVerseCache.has(key)) {
      return this.nkjvVerseCache.get(key);
    }

    const chapterKey = chapterCacheKey(bookId, chapterNumber);
    const cachedChapter = this.nkjvChapterCache.get(chapterKey);
    if (Array.isArray(cachedChapter) && cachedChapter.length > 0) {
      const verse = cachedChapter.find((item) => Number(item.verse) === Number(verseNumber));
      if (verse) {
        this.nkjvVerseCache.set(key, { verse: verse.verse, text: verse.text });
        return this.nkjvVerseCache.get(key);
      }
    }

    const numericBookId = extractNumericBookId(bookId);
    if (!numericBookId) {
      return null;
    }

    const requestKey = verseRequestKey(bookId, chapterNumber, verseNumber);
    if (this.nkjvInFlight.has(requestKey)) {
      return this.nkjvInFlight.get(requestKey);
    }

    const request = fetch(`${NKJV_VERSE_API_BASE}/${numericBookId}/${chapterNumber}/${verseNumber}/`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `Failed to load NKJV verse ${bookId} ${chapterNumber}:${verseNumber}: ${response.status}`
          );
        }
        return response.json();
      })
      .then((payload) => {
        const verses = parseNkjvVerses(payload);
        const verse = verses.find((item) => Number(item.verse) === Number(verseNumber)) || verses[0] || null;
        if (!verse) {
          return null;
        }

        const normalized = { verse: Number(verse.verse), text: verse.text };
        this.nkjvVerseCache.set(key, normalized);
        return normalized;
      })
      .finally(() => {
        this.nkjvInFlight.delete(requestKey);
      });

    this.nkjvInFlight.set(requestKey, request);
    return request;
  }

  async preloadNkjvForSelection(bookId, chapterNumber, selectedVerses = null) {
    if (!Array.isArray(selectedVerses)) {
      await this.loadNkjvChapter(bookId, chapterNumber);
      return;
    }

    if (selectedVerses.length === 0) {
      return;
    }

    await Promise.all(
      selectedVerses.map((verseNumber) => this.loadNkjvVerse(bookId, chapterNumber, verseNumber))
    );
  }

  // One request per file however many callers ask; resolves null when it cannot be read
  fetchJson(path) {
    if (!this.jsonRequests.has(path)) {
      const request = Promise.resolve()
        .then(() => fetch(path))
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
      this.jsonRequests.set(path, request);
    }
    return this.jsonRequests.get(path);
  }

  // Starts every startup file at once; the loaders below then reuse these requests
  prefetch() {
    for (const path of [MANIFEST_PATH, PACK_INDEX_PATH, YEARS_PATH, PRACTICE_BOOKS_PATH, PRACTICE_YEARS_PATH]) {
      this.fetchJson(path);
    }
  }

  setManifest(manifest) {
    this.manifest = manifest;
    this.chapterHashes = new Map();
    for (const book of manifest.books || []) {
      for (const chapter of book.chapters || []) {
        if (chapter.hash) {
          this.chapterHashes.set(chapterCacheKey(book.id, chapter.number), chapter.hash);
        }
      }
    }
    return manifest;
  }

  async loadManifest() {
    if (this.manifest) {
      return this.manifest;
    }

    const localBundle = getLocalBundle();
    if (localBundle?.manifest) {
      return this.setManifest(localBundle.manifest);
    }

    const manifest = await this.fetchJson(MANIFEST_PATH);
    if (manifest) {
      return this.setManifest(manifest);
    }

    // Opened from disk: fetch() is blocked, but a script tag can still read the local bundle
    if (globalThis.location?.protocol === "file:") {
      await Promise.all(
        [LOCAL_BUNDLE_PATH, "questions/v1/practice-books.bundle.js", "questions/v1/practice-years.bundle.js"].map(
          (src) => loadScriptOnce(src).catch(() => {})
        )
      );
      if (getLocalBundle()?.manifest) {
        return this.setManifest(getLocalBundle().manifest);
      }
    }

    this.jsonRequests.delete(MANIFEST_PATH);
    throw new Error("Failed to load manifest.json");
  }

  // Loads a season's questions in one request (cached in IndexedDB between visits)
  // instead of one request per chapter. Anything it cannot supply still loads
  // chapter by chapter, so a missing or stale pack only costs speed.
  loadYearPack(year) {
    if (!year) {
      return Promise.resolve();
    }
    const requestKey = year.id || year.name;
    if (!this.packRequests.has(requestKey)) {
      this.packRequests.set(
        requestKey,
        this.loadYearPackUncached(year).catch((error) => {
          console.warn(`Season pack unavailable for ${year.name}`, error);
        })
      );
    }
    return this.packRequests.get(requestKey);
  }

  async loadYearPackUncached(year) {
    const index = await this.fetchJson(PACK_INDEX_PATH);
    const packYearId = [year.name, year.id].find((candidate) => index?.years?.[candidate]);
    if (!packYearId) {
      return;
    }
    const entry = index.years[packYearId];

    let pack = await this.packStore.get(packYearId, entry.hash);
    if (!pack) {
      pack = await this.fetchJson(`questions/v1/${entry.path}`);
      if (!pack?.chapters) {
        return;
      }
      this.packStore.set(packYearId, entry.hash, pack);
    }

    await this.loadManifest();
    for (const [key, chapterJson] of Object.entries(pack.chapters)) {
      // A pack built before the latest data push must not shadow newer chapters
      if (this.chapterCache.has(key) || pack.hashes?.[key] !== this.chapterHashes.get(key)) {
        continue;
      }
      const bookId = chapterJson.bookId || key.split(":")[0];
      this.chapterCache.set(
        key,
        (chapterJson.questions || []).map((question) => normalizeQuestion(question, bookId, chapterJson))
      );
    }
  }

  async loadChapter(bookId, chapterNumber) {
    const written = await this.loadWrittenChapter(bookId, chapterNumber);
    const own = this.customByChapter.get(chapterCacheKey(bookId, chapterNumber));
    return own ? [...written, ...own] : written;
  }

  async loadWrittenChapter(bookId, chapterNumber) {
    const key = chapterCacheKey(bookId, chapterNumber);
    if (this.chapterCache.has(key)) {
      return this.chapterCache.get(key);
    }

    const localBundle = getLocalBundle();
    const localChapter = localBundle?.chapters?.[key];
    if (localChapter) {
      const normalizedLocal = (localChapter.questions || []).map((question) =>
        normalizeQuestion(question, bookId, localChapter)
      );
      this.chapterCache.set(key, normalizedLocal);
      return normalizedLocal;
    }

    const manifest = await this.loadManifest();
    const book = manifest.books.find((item) => item.id === bookId);
    if (!book) {
      throw new Error(`Book not found: ${bookId}`);
    }

    const chapterMeta = book.chapters.find((item) => item.number === chapterNumber);
    if (!chapterMeta) {
      throw new Error(`Chapter not found: ${bookId} ${chapterNumber}`);
    }

    // Intro passages and chapters that only exist for verse text have no question file
    if (chapterMeta.intro || chapterMeta.questions === 0) {
      this.chapterCache.set(key, []);
      return [];
    }

    let chapterJson = null;
    try {
      const version = chapterMeta.hash ? `?v=${chapterMeta.hash}` : "";
      const response = await fetch(`${CHAPTER_BASE_PATH}/${chapterMeta.path}${version}`);
      if (!response.ok) {
        console.warn(`Skipping missing chapter file: ${chapterMeta.path}`);
        this.chapterCache.set(key, []);
        return [];
      }

      chapterJson = await response.json();
    } catch (error) {
      console.warn(`Skipping chapter due to load error: ${chapterMeta.path}`, error);
      this.chapterCache.set(key, []);
      return [];
    }

    const normalized = (chapterJson.questions || []).map((question) =>
      normalizeQuestion(question, bookId, chapterJson)
    );

    this.chapterCache.set(key, normalized);
    return normalized;
  }

  createDefaultYearConfig(manifest) {
    const scope = {};
    for (const book of manifest.books) {
      scope[book.id] = book.chapters.map((chapter) => chapter.number);
    }

    return [
      {
        id: "current-year",
        name: "Current Year",
        scope,
      },
    ];
  }

  buildManifestBookLookup(manifest) {
    const lookup = new Map();
    for (const book of manifest.books || []) {
      const normalizedName = normalizeBookKey(book.name);
      if (normalizedName) {
        lookup.set(normalizedName, book.id);
      }

      const idTail = String(book.id || "").split("-").slice(1).join("-");
      const normalizedTail = normalizeBookKey(idTail);
      if (normalizedTail) {
        lookup.set(normalizedTail, book.id);
      }
    }
    return lookup;
  }

  ensurePracticeBooksInManifest(manifest, practiceBooks) {
    if (!practiceBooks || typeof practiceBooks !== "object") {
      return;
    }

    const existingByNormalized = this.buildManifestBookLookup(manifest);
    const existingIds = new Set((manifest.books || []).map((book) => book.id));

    for (const [bookKey, meta] of Object.entries(practiceBooks)) {
      const normalized = normalizeBookKey(bookKey);
      if (!normalized || existingByNormalized.has(normalized)) {
        continue;
      }

      const numericId = Number(meta?.id);
      const slug = normalizeSlug(bookKey);
      if (!Number.isFinite(numericId) || !slug) {
        continue;
      }

      const syntheticId = `${numericId}-${slug}`;
      if (existingIds.has(syntheticId)) {
        existingByNormalized.set(normalized, syntheticId);
        continue;
      }

      const verseCounts = Array.isArray(meta.verseCounts) ? meta.verseCounts : [];
      const totalChapters = Number(meta.totalChapters) || verseCounts.length;
      if (!Number.isInteger(totalChapters) || totalChapters <= 0) {
        continue;
      }

      const chapters = [];
      for (let chapter = 1; chapter <= totalChapters; chapter += 1) {
        const fileName = String(chapter).padStart(3, "0");
        chapters.push({
          number: chapter,
          path: `by-chapter/${syntheticId}/${fileName}.json`,
          verses: Number(verseCounts[chapter - 1]) || 0,
          questions: 0,
        });
      }

      manifest.books.push({
        id: syntheticId,
        name: meta.label || bookKey,
        chapters,
      });

      existingIds.add(syntheticId);
      existingByNormalized.set(normalized, syntheticId);
    }

    this.registerIntroChapters(manifest, practiceBooks);
  }

  // Books with commentary get an "Intro" pseudo-chapter 0 holding its text;
  // it only produces fill-in-the-blank questions (no written questions exist)
  registerIntroChapters(manifest, practiceBooks) {
    const lookup = this.buildManifestBookLookup(manifest);
    for (const [bookKey, meta] of Object.entries(practiceBooks)) {
      const commentary = Array.isArray(meta?.commentary) ? meta.commentary : [];
      const partCount = commentary.reduce((sum, section) => sum + (section.parts?.length || 0), 0);
      const book = (manifest.books || []).find((item) => item.id === lookup.get(normalizeBookKey(bookKey)));
      if (!book || partCount === 0) {
        continue;
      }

      this.introByBookId.set(book.id, commentary);
      if (!book.chapters.some((chapter) => chapter.number === 0)) {
        book.chapters.unshift({ number: 0, path: null, verses: partCount, questions: 0, intro: true });
      }
    }
  }

  buildPracticeYearConfigs(rawPracticeYears, manifest) {
    if (!rawPracticeYears || typeof rawPracticeYears !== "object") {
      return [];
    }

    const manifestBookLookup = this.buildManifestBookLookup(manifest);
    const manifestChapterSets = new Map(
      (manifest.books || []).map((book) => [
        book.id,
        new Set((book.chapters || []).map((chapter) => Number(chapter.number))),
      ])
    );

    const configs = [];
    for (const [yearId, selections] of Object.entries(rawPracticeYears)) {
      if (!Array.isArray(selections)) {
        continue;
      }

      const scopeSets = {};
      const verseSets = {};
      const wholeChapters = new Set();

      for (const selection of selections) {
        const sourceKey = normalizeBookKey(selection?.bookKey);
        const manifestBookId = manifestBookLookup.get(sourceKey);
        if (!manifestBookId) {
          continue;
        }

        const availableChapters = manifestChapterSets.get(manifestBookId);
        if (!availableChapters || availableChapters.size === 0) {
          continue;
        }

        const start = Number(selection?.start);
        const end = Number(selection?.end);
        if (!Number.isInteger(start) || !Number.isInteger(end)) {
          continue;
        }

        const lower = Math.min(start, end);
        const upper = Math.max(start, end);
        if (!scopeSets[manifestBookId]) {
          scopeSets[manifestBookId] = new Set();
        }

        for (let chapter = lower; chapter <= upper; chapter += 1) {
          if (availableChapters.has(chapter)) {
            scopeSets[manifestBookId].add(chapter);
          }
        }

        // A book's intro is studied along with the book from its first chapter
        if (lower <= 1 && availableChapters.has(0)) {
          scopeSets[manifestBookId].add(0);
        }

        // "include" limits a single chapter to some verse ranges (e.g. Ezra 8:15-36)
        const key = `${manifestBookId}:${lower}`;
        if (Array.isArray(selection.include) && lower === upper) {
          verseSets[key] = verseSets[key] || new Set();
          for (const [from, to] of selection.include) {
            for (let verse = Number(from); verse <= Number(to); verse += 1) {
              verseSets[key].add(verse);
            }
          }
        } else {
          for (let chapter = lower; chapter <= upper; chapter += 1) {
            wholeChapters.add(`${manifestBookId}:${chapter}`);
          }
        }
      }

      const verses = {};
      for (const [key, set] of Object.entries(verseSets)) {
        if (!wholeChapters.has(key)) {
          verses[key] = Array.from(set).sort((a, b) => a - b);
        }
      }

      const scope = {};
      for (const [bookId, chapters] of Object.entries(scopeSets)) {
        const sorted = Array.from(chapters).sort((a, b) => a - b);
        if (sorted.length > 0) {
          scope[bookId] = sorted;
        }
      }

      configs.push({
        id: yearId,
        name: yearId,
        scope,
        verses,
      });
    }

    return configs;
  }

  mergeYearConfigs(primaryYears, additionalYears) {
    const merged = new Map();
    const byName = new Map();

    for (const year of primaryYears) {
      merged.set(year.id, year);
      byName.set(String(year.name).toLowerCase(), year.id);
    }

    for (const year of additionalYears) {
      if (merged.has(year.id)) {
        continue;
      }

      const normalizedName = String(year.name).toLowerCase();
      if (byName.has(normalizedName)) {
        const existingId = byName.get(normalizedName);
        const existing = merged.get(existingId);
        const existingScope = existing?.implicitScope ? {} : existing?.scope || {};
        const incomingScope = year.scope || {};
        const mergedScope = { ...existingScope };

        for (const [bookId, chapters] of Object.entries(incomingScope)) {
          const combined = new Set([...(mergedScope[bookId] || []), ...(chapters || [])]);
          mergedScope[bookId] = Array.from(combined).sort((a, b) => a - b);
        }

        const existingScore = scopeChapterCount(existingScope);
        const incomingScore = scopeChapterCount(incomingScope);

        merged.set(existingId, {
          ...existing,
          name: existing?.name || year.name,
          implicitScope: undefined,
          scope: mergedScope,
          verses: { ...(year.verses || {}), ...(existing?.verses || {}) },
        });
        continue;
      }

      merged.set(year.id, year);
      byName.set(normalizedName, year.id);
    }

    return Array.from(merged.values()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  async loadYears(manifest) {
    const allScope = this.createDefaultYearConfig(manifest)[0].scope;

    let practiceBooks = getPracticeBooksBundle();
    if (!practiceBooks || typeof practiceBooks !== "object") {
      practiceBooks = await this.fetchJson(PRACTICE_BOOKS_PATH);
    }

    this.ensurePracticeBooksInManifest(manifest, practiceBooks);

    let primaryYears = [];
    const localBundle = getLocalBundle();
    if (localBundle?.years?.years?.length) {
      primaryYears = localBundle.years.years.map((year) => this.primaryYearConfig(year, allScope));
    } else {
      const payload = await this.fetchJson(YEARS_PATH);
      if (Array.isArray(payload?.years) && payload.years.length > 0) {
        primaryYears = payload.years.map((year) => this.primaryYearConfig(year, allScope));
      }
    }

    if (primaryYears.length === 0) {
      primaryYears = this.createDefaultYearConfig(manifest);
    }

    const bundledPracticeYears = getPracticeYearsBundle();
    if (bundledPracticeYears && typeof bundledPracticeYears === "object") {
      const practiceYears = this.buildPracticeYearConfigs(bundledPracticeYears, manifest);
      return this.withCustomYear(this.mergeYearConfigs(primaryYears, practiceYears), manifest);
    }

    const practicePayload = await this.fetchJson(PRACTICE_YEARS_PATH);
    if (!practicePayload) {
      return this.withCustomYear(primaryYears, manifest);
    }
    const practiceYears = this.buildPracticeYearConfigs(practicePayload, manifest);
    return this.withCustomYear(this.mergeYearConfigs(primaryYears, practiceYears), manifest);
  }

  // A years.json entry without a scope means "everything" until a season of the same
  // name supplies the real chapters (see mergeYearConfigs)
  primaryYearConfig(year, allScope) {
    const hasScope = Boolean(year.scope) && typeof year.scope === "object";
    return {
      id: year.id,
      name: year.name,
      scope: hasScope ? year.scope : structuredClone(allScope),
      ...(hasScope ? {} : { implicitScope: true }),
    };
  }

  // "Custom - Entire Bible": pick any chapter of any book, like the study tool's
  // custom option. Added last so seasons keep their order.
  withCustomYear(years, manifest) {
    if (years.some((year) => year.id === CUSTOM_YEAR_ID)) {
      return years;
    }
    return [
      ...years,
      {
        id: CUSTOM_YEAR_ID,
        name: "Custom - Entire Bible",
        scope: this.createDefaultYearConfig(manifest)[0].scope,
        verses: {},
      },
    ];
  }

  countQuestionsInManifest(manifest) {
    return manifest.books.reduce(
      (sum, book) => sum + book.chapters.reduce((bookSum, chapter) => bookSum + chapter.questions, 0),
      0
    );
  }
}
