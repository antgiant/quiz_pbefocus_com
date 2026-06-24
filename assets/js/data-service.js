import { QUESTION_DIFFICULTIES, QUESTION_TYPES } from "./constants.js";

const MANIFEST_PATH = "questions/v1/manifest.json";
const CHAPTER_BASE_PATH = "questions/v1";
const YEARS_PATH = "questions/v1/years.json";

function getLocalBundle() {
  return window.PBE_LOCAL_DATA || null;
}

function chapterCacheKey(bookId, chapterNumber) {
  return `${bookId}:${chapterNumber}`;
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

  async loadYears(manifest) {
    const localBundle = getLocalBundle();
    if (localBundle?.years?.years?.length) {
      return localBundle.years.years.map((year) => ({
        id: year.id,
        name: year.name,
        scope: year.scope && typeof year.scope === "object" ? year.scope : null,
      })).map((year) => ({
        ...year,
        scope: year.scope || this.createDefaultYearConfig(manifest)[0].scope,
      }));
    }

    try {
      const response = await fetch(YEARS_PATH);
      if (!response.ok) {
        return this.createDefaultYearConfig(manifest);
      }

      const payload = await response.json();
      if (!Array.isArray(payload.years) || payload.years.length === 0) {
        return this.createDefaultYearConfig(manifest);
      }

      const allScope = this.createDefaultYearConfig(manifest)[0].scope;
      return payload.years.map((year) => ({
        id: year.id,
        name: year.name,
        scope: year.scope && typeof year.scope === "object" ? year.scope : structuredClone(allScope),
      }));
    } catch {
      return this.createDefaultYearConfig(manifest);
    }
  }

  countQuestionsInManifest(manifest) {
    return manifest.books.reduce(
      (sum, book) => sum + book.chapters.reduce((bookSum, chapter) => bookSum + chapter.questions, 0),
      0
    );
  }
}
