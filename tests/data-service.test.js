import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataService, buildIntroVerses } from "../assets/js/data-service.js";
import { VerseStore } from "../assets/js/verse-store.js";

function memoryStore() {
  const data = new Map();
  return {
    data,
    get: vi.fn(async (key) => data.get(key) ?? null),
    set: vi.fn(async (key, verses) => {
      data.set(key, verses);
      return true;
    }),
  };
}

const PRACTICE_BOOKS = {
  mark: { id: 41, totalChapters: 2, label: "Mark", verseCounts: [45, 28] },
  ezra: { id: 15, totalChapters: 10, label: "Ezra", verseCounts: [11, 70, 13, 24, 17, 22, 28, 36, 15, 44] },
  ruth: {
    id: 8,
    totalChapters: 4,
    label: "Ruth",
    verseCounts: [22, 23, 18, 22],
    commentary: [
      { title: "Title", parts: ["First.", "Second."] },
      { title: "Theme", parts: ["Only."] },
    ],
  },
};

function manifest() {
  return {
    books: [
      {
        id: "41-mark",
        name: "Mark",
        chapters: [
          { number: 1, path: "by-chapter/41-mark/001.json", verses: 45, questions: 10 },
          { number: 2, path: "by-chapter/41-mark/002.json", verses: 28, questions: 10 },
        ],
      },
    ],
  };
}

describe("buildIntroVerses", () => {
  it("numbers each paragraph and labels multi-part sections", () => {
    const verses = buildIntroVerses(PRACTICE_BOOKS.ruth.commentary);
    expect(verses.map((verse) => verse.verse)).toEqual([1, 2, 3]);
    expect(verses.map((verse) => verse.label)).toEqual(["Title (Part 1/2)", "Title (Part 2/2)", "Theme"]);
    expect(verses[0].text).toBe("<strong>Title.</strong> First.");
  });

  it("returns nothing without commentary", () => {
    expect(buildIntroVerses(undefined)).toEqual([]);
  });
});

describe("intro chapters and year scopes", () => {
  let service;
  let doc;

  beforeEach(() => {
    service = new DataService({ store: memoryStore() });
    doc = manifest();
    service.ensurePracticeBooksInManifest(doc, PRACTICE_BOOKS);
    service.manifest = doc;
  });

  it("adds a chapter 0 only to books that have commentary", () => {
    const ruth = doc.books.find((book) => book.name === "Ruth");
    expect(ruth.chapters[0]).toMatchObject({ number: 0, intro: true, verses: 3 });
    expect(doc.books.find((book) => book.id === "41-mark").chapters.some((c) => c.number === 0)).toBe(false);
    expect(service.hasIntro(ruth.id)).toBe(true);
  });

  it("does not add the intro twice", () => {
    service.ensurePracticeBooksInManifest(doc, PRACTICE_BOOKS);
    const ruth = doc.books.find((book) => book.name === "Ruth");
    expect(ruth.chapters.filter((chapter) => chapter.number === 0)).toHaveLength(1);
  });

  it("loads intro text as verses without a network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const ruth = doc.books.find((book) => book.name === "Ruth");
    const verses = await service.loadNkjvChapter(ruth.id, 0);
    expect(verses).toHaveLength(3);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("has no written questions for an intro", async () => {
    const ruth = doc.books.find((book) => book.name === "Ruth");
    expect(await service.loadChapter(ruth.id, 0)).toEqual([]);
  });

  it("includes the intro in a year that starts at chapter 1 and keeps verse ranges", () => {
    const configs = service.buildPracticeYearConfigs(
      {
        "2019-2020": [
          { bookKey: "ruth", start: 1, end: 4 },
          { bookKey: "ezra", start: 8, end: 8, include: [[15, 17], [20, 21]] },
          { bookKey: "ezra", start: 10, end: 10 },
        ],
      },
      doc
    );
    const year = configs[0];
    const ruthId = doc.books.find((book) => book.name === "Ruth").id;
    const ezraId = doc.books.find((book) => book.name === "Ezra").id;
    expect(year.scope[ruthId]).toEqual([0, 1, 2, 3, 4]);
    expect(year.scope[ezraId]).toEqual([8, 10]);
    expect(year.verses).toEqual({ [`${ezraId}:8`]: [15, 16, 17, 20, 21] });
  });

  it("does not restrict a chapter that is also selected whole", () => {
    const [year] = service.buildPracticeYearConfigs(
      {
        y: [
          { bookKey: "ezra", start: 8, end: 8, include: [[1, 5]] },
          { bookKey: "ezra", start: 7, end: 9 },
        ],
      },
      doc
    );
    expect(year.verses).toEqual({});
  });

  it("keeps verse ranges when two year configs merge", () => {
    const merged = service.mergeYearConfigs(
      [{ id: "a", name: "Same", scope: {}, verses: { "x:1": [1] } }],
      [{ id: "b", name: "same", scope: {}, verses: { "y:2": [2] } }]
    );
    expect(merged[0].verses).toEqual({ "y:2": [2], "x:1": [1] });
  });
});

describe("NKJV chapter caching", () => {
  const payload = [
    { verse: 1, text: "In the beginning" },
    { verse: 2, text: "And the earth" },
  ];

  it("fetches once, stores the chapter, and reuses it", async () => {
    const store = memoryStore();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true, json: async () => payload });
    const service = new DataService({ store });

    const first = await service.loadNkjvChapter("1-genesis", 1);
    expect(first).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(store.set).toHaveBeenCalledWith("1-genesis:1", first);

    const second = new DataService({ store });
    expect(await second.loadNkjvChapter("1-genesis", 1)).toEqual(first);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it("reports a failed download and does not cache it", async () => {
    const store = memoryStore();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 503 });
    const service = new DataService({ store });
    await expect(service.loadNkjvChapter("1-genesis", 1)).rejects.toThrow(/503/);
    expect(store.set).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("VerseStore", () => {
  it("round-trips chapters through IndexedDB", async () => {
    const store = new VerseStore(indexedDB);
    expect(await store.get("a:1")).toBeNull();
    expect(await store.set("a:1", [{ verse: 1, text: "x" }])).toBe(true);
    expect(await store.get("a:1")).toEqual([{ verse: 1, text: "x" }]);
  });

  it("ignores empty chapters", async () => {
    const store = new VerseStore(indexedDB);
    expect(await store.set("a:2", [])).toBe(false);
    expect(await store.get("a:2")).toBeNull();
  });

  it("degrades to uncached when IndexedDB is unavailable", async () => {
    const store = new VerseStore(null);
    expect(await store.get("a:1")).toBeNull();
    expect(await store.set("a:1", [{ verse: 1, text: "x" }])).toBe(false);
  });
});
