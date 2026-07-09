import { QUESTION_DIFFICULTIES, QUESTION_TYPES } from "./constants.js";

const MANIFEST_PATH = "questions/v1/manifest.json";
const CHAPTER_BASE_PATH = "questions/v1";
const YEARS_PATH = "questions/v1/years.json";
const PRACTICE_YEARS_PATH = "questions/v1/practice-chapters-by-year.json";
const PRACTICE_BOOKS_PATH = "questions/v1/practice-books.json";
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
  return {
    ...question,
    bookId,
    book: chapterJson.book,
    chapter: chapterJson.chapter,
    startVerse: question.ref?.startVerse,
    endVerse: question.ref?.endVerse,
    type: QUESTION_TYPES.includes(question.type) ? question.type : "other",
    difficulty: normalizeDifficulty(question),
  };
}

export class DataService {
  constructor() {
    this.manifest = null;
    this.chapterCache = new Map();
    this.nkjvChapterCache = new Map();
    this.nkjvVerseCache = new Map();
    this.nkjvInFlight = new Map();
  }

  async loadNkjvChapter(bookId, chapterNumber) {
    const chapterKey = chapterCacheKey(bookId, chapterNumber);
    if (this.nkjvChapterCache.has(chapterKey)) {
      return this.nkjvChapterCache.get(chapterKey);
    }

    const numericBookId = extractNumericBookId(bookId);
    if (!numericBookId) {
      return [];
    }

    const requestKey = chapterRequestKey(bookId, chapterNumber);
    if (this.nkjvInFlight.has(requestKey)) {
      return this.nkjvInFlight.get(requestKey);
    }

    const request = fetch(`${NKJV_CHAPTER_API_BASE}/${numericBookId}/${chapterNumber}/`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load NKJV chapter ${bookId} ${chapterNumber}: ${response.status}`);
        }
        return response.json();
      })
      .then((payload) => {
        const verses = parseNkjvVerses(payload);
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

  async loadManifest() {
    if (this.manifest) {
      return this.manifest;
    }

    const localBundle = getLocalBundle();
    if (localBundle?.manifest) {
      this.manifest = localBundle.manifest;
      return this.manifest;
    }

    const response = await fetch(MANIFEST_PATH);
    if (!response.ok) {
      throw new Error("Failed to load manifest.json");
    }

    this.manifest = await response.json();
    return this.manifest;
  }

  async loadChapter(bookId, chapterNumber) {
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

    let chapterJson = null;
    try {
      const response = await fetch(`${CHAPTER_BASE_PATH}/${chapterMeta.path}`);
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
        const existingScope = existing?.scope || {};
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
          scope: mergedScope,
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
      try {
        const booksResponse = await fetch(PRACTICE_BOOKS_PATH);
        if (booksResponse.ok) {
          practiceBooks = await booksResponse.json();
        }
      } catch {
        practiceBooks = null;
      }
    }

    this.ensurePracticeBooksInManifest(manifest, practiceBooks);

    let primaryYears = [];
    const localBundle = getLocalBundle();
    if (localBundle?.years?.years?.length) {
      primaryYears = localBundle.years.years.map((year) => ({
        id: year.id,
        name: year.name,
        scope: year.scope && typeof year.scope === "object" ? year.scope : null,
      })).map((year) => ({
        ...year,
        scope: year.scope || structuredClone(allScope),
      }));
    } else {
      try {
        const response = await fetch(YEARS_PATH);
        if (response.ok) {
          const payload = await response.json();
          if (Array.isArray(payload.years) && payload.years.length > 0) {
            primaryYears = payload.years.map((year) => ({
              id: year.id,
              name: year.name,
              scope: year.scope && typeof year.scope === "object" ? year.scope : structuredClone(allScope),
            }));
          }
        }
      } catch {
        primaryYears = [];
      }
    }

    if (primaryYears.length === 0) {
      primaryYears = this.createDefaultYearConfig(manifest);
    }

    const bundledPracticeYears = getPracticeYearsBundle();
    if (bundledPracticeYears && typeof bundledPracticeYears === "object") {
      const practiceYears = this.buildPracticeYearConfigs(bundledPracticeYears, manifest);
      return this.mergeYearConfigs(primaryYears, practiceYears);
    }

    try {
      const practiceResponse = await fetch(PRACTICE_YEARS_PATH);
      if (!practiceResponse.ok) {
        return primaryYears;
      }

      const practicePayload = await practiceResponse.json();
      const practiceYears = this.buildPracticeYearConfigs(practicePayload, manifest);
      return this.mergeYearConfigs(primaryYears, practiceYears);
    } catch {
      return primaryYears;
    }
  }

  countQuestionsInManifest(manifest) {
    return manifest.books.reduce(
      (sum, book) => sum + book.chapters.reduce((bookSum, chapter) => bookSum + chapter.questions, 0),
      0
    );
  }
}
