import { afterEach, describe, expect, it, vi } from "vitest";
import { DataService, currentSeasonStart, pickDefaultYear } from "../assets/js/data-service.js";
import { loadVendor } from "../assets/js/lazy-vendor.js";
import { AnalysisStore } from "../assets/js/analysis-store.js";
import { PackStore } from "../assets/js/pack-store.js";

const MANIFEST = {
  books: [
    {
      id: "41-mark",
      name: "Mark",
      chapters: [
        { number: 1, path: "by-chapter/41-mark/001.json", verses: 45, questions: 1, hash: "aaa" },
        { number: 2, path: "by-chapter/41-mark/002.json", verses: 28, questions: 1, hash: "bbb" },
        { number: 3, path: "by-chapter/41-mark/003.json", verses: 35, questions: 0 },
      ],
    },
  ],
};

function chapterJson(number) {
  return {
    bookId: "41-mark",
    book: "Mark",
    chapter: number,
    questions: [{ id: `q${number}`, ref: { startVerse: 1, endVerse: 1 }, question: "?", answer: "!", type: "what", points: 1 }],
  };
}

const PACK_INDEX = { years: { "2026-2027": { path: "packs/2026-2027.h1.json", hash: "h1" } } };
const PACK = {
  yearId: "2026-2027",
  hashes: { "41-mark:1": "aaa", "41-mark:2": "stale" },
  chapters: { "41-mark:1": chapterJson(1), "41-mark:2": chapterJson(2) },
};

function memoryPackStore() {
  const records = new Map();
  return {
    records,
    get: vi.fn(async (yearId, hash) => (records.get(yearId)?.hash === hash ? records.get(yearId).pack : null)),
    set: vi.fn(async (yearId, hash, pack) => {
      records.set(yearId, { hash, pack });
      return true;
    }),
  };
}

function mockFetch(routes) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const key = Object.keys(routes).find((route) => String(url).includes(route));
    return key ? { ok: true, json: async () => routes[key] } : { ok: false, status: 404 };
  });
}

function service(packStore = memoryPackStore()) {
  const instance = new DataService({ store: { get: vi.fn(), set: vi.fn() }, packStore });
  instance.setManifest(structuredClone(MANIFEST));
  return instance;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("season packs", () => {
  it("serves a season's chapters from one pack request", async () => {
    const fetchSpy = mockFetch({ "packs/index.json": PACK_INDEX, "packs/2026-2027.h1.json": PACK });
    const data = service();

    await data.loadYearPack({ id: "2026-current", name: "2026-2027" });
    const questions = await data.loadChapter("41-mark", 1);

    expect(questions[0]).toMatchObject({ id: "q1", bookId: "41-mark", chapter: 1, startVerse: 1 });
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      "questions/v1/packs/index.json",
      "questions/v1/packs/2026-2027.h1.json",
    ]);
  });

  it("ignores pack chapters whose hash no longer matches the manifest", async () => {
    const fetchSpy = mockFetch({
      "packs/index.json": PACK_INDEX,
      "packs/2026-2027.h1.json": PACK,
      "by-chapter/41-mark/002.json": chapterJson(2),
    });
    const data = service();

    await data.loadYearPack({ id: "2026-2027", name: "2026-2027" });
    await data.loadChapter("41-mark", 2);

    expect(fetchSpy).toHaveBeenLastCalledWith("questions/v1/by-chapter/41-mark/002.json?v=bbb");
  });

  it("reuses the stored pack on the next visit", async () => {
    const packStore = memoryPackStore();
    mockFetch({ "packs/index.json": PACK_INDEX, "packs/2026-2027.h1.json": PACK });
    await service(packStore).loadYearPack({ id: "2026-2027", name: "2026-2027" });

    vi.restoreAllMocks();
    const fetchSpy = mockFetch({ "packs/index.json": PACK_INDEX });
    const second = service(packStore);
    await second.loadYearPack({ id: "2026-2027", name: "2026-2027" });

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual(["questions/v1/packs/index.json"]);
    expect(await second.loadChapter("41-mark", 1)).toHaveLength(1);
  });

  it("does nothing for a season without a pack", async () => {
    const fetchSpy = mockFetch({ "packs/index.json": PACK_INDEX });
    await service().loadYearPack({ id: "2012-2013", name: "2012-2013" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("asks for each file only once", async () => {
    const fetchSpy = mockFetch({ "packs/index.json": PACK_INDEX, "packs/2026-2027.h1.json": PACK });
    const data = service();
    const year = { id: "2026-2027", name: "2026-2027" };

    await Promise.all([data.loadYearPack(year), data.loadYearPack(year)]);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("chapter loading", () => {
  it("does not request chapters that have no question file", async () => {
    const fetchSpy = mockFetch({});
    const data = service();

    expect(await data.loadChapter("41-mark", 3)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("season list", () => {
  it("limits a scope-less years.json entry to the season of the same name", async () => {
    mockFetch({
      "years.json": { years: [{ id: "2026-current", name: "2026-2027" }] },
      "practice-chapters-by-year.json": { "2026-2027": [{ bookKey: "mark", start: 1, end: 2 }] },
    });
    const data = new DataService({ store: {}, packStore: memoryPackStore() });
    const manifest = structuredClone(MANIFEST);

    const years = await data.loadYears(manifest);
    const season = years.find((year) => year.id === "2026-current");

    expect(season.scope).toEqual({ "41-mark": [1, 2] });
    expect(season.implicitScope).toBeUndefined();
  });

  it("keeps a scope-less entry as everything when no season matches", async () => {
    mockFetch({ "years.json": { years: [{ id: "all", name: "Everything" }] } });
    const data = new DataService({ store: {}, packStore: memoryPackStore() });

    const years = await data.loadYears(structuredClone(MANIFEST));

    expect(years.find((year) => year.id === "all").scope["41-mark"]).toEqual([1, 2, 3]);
  });
});

describe("PackStore", () => {
  it("returns a pack only for the version it was saved as", async () => {
    const store = new PackStore();
    await store.set("2026-2027", "h1", { chapters: {} });

    expect(await store.get("2026-2027", "h1")).toEqual({ chapters: {} });
    expect(await store.get("2026-2027", "h2")).toBeNull();
    expect(await store.get("2030-2031", "h1")).toBeNull();
  });

  it("keeps one record per season when a new version is saved", async () => {
    const store = new PackStore();
    await store.set("2026-2027", "h1", { version: 1 });
    await store.set("2026-2027", "h2", { version: 2 });

    expect(await store.get("2026-2027", "h1")).toBeNull();
    expect(await store.get("2026-2027", "h2")).toEqual({ version: 2 });
  });

  it("is a miss when IndexedDB is unavailable", async () => {
    const store = new PackStore(null);

    expect(await store.set("y", "h", {})).toBe(false);
    expect(await store.get("y", "h")).toBeNull();
  });
});

describe("loadVendor", () => {
  it("skips a bundle whose global already exists", async () => {
    const append = vi.spyOn(document.head, "append");

    await loadVendor("compromise");

    expect(append).not.toHaveBeenCalled();
  });

  it("rejects an unknown bundle", async () => {
    await expect(loadVendor("nope")).rejects.toThrow(/Unknown vendor/);
  });
});

describe("default season", () => {
  const years = [
    { id: "2011-2012", name: "2011-2012", scope: { "41-mark": [1] } },
    { id: "2026-current", name: "2026-2027", scope: { "41-mark": [1] } },
    { id: "2027-2028", name: "2027-2028", scope: { "23-isaiah": [34] } },
    { id: "2030-2031", name: "2030-2031", scope: {} },
    { id: "custom-all", name: "Custom - Entire Bible", scope: { "41-mark": [1] } },
  ];

  it("starts a season in July", () => {
    expect(currentSeasonStart(new Date(2026, 5, 30))).toBe(2025);
    expect(currentSeasonStart(new Date(2026, 6, 1))).toBe(2026);
    expect(currentSeasonStart(new Date(2027, 2, 15))).toBe(2026);
  });

  it("opens on the current season", () => {
    expect(pickDefaultYear(years, new Date(2026, 9, 23)).id).toBe("2026-current");
    expect(pickDefaultYear(years, new Date(2027, 8, 1)).id).toBe("2027-2028");
  });

  it("falls back to the latest earlier season with chapters, then the first", () => {
    expect(pickDefaultYear(years, new Date(2030, 9, 1)).id).toBe("2027-2028");
    expect(pickDefaultYear(years, new Date(2005, 9, 1)).id).toBe("2011-2012");
    expect(pickDefaultYear([{ id: "x", name: "Custom", scope: {} }], new Date()).id).toBe("x");
  });
});

describe("AnalysisStore", () => {
  it("saves and returns analysis entries", async () => {
    const store = new AnalysisStore();
    expect(await store.get()).toEqual([]);

    await store.set([["a verse", [["a", 5]]]]);

    expect(await store.get()).toEqual([["a verse", [["a", 5]]]]);
  });

  it("returns nothing when IndexedDB is unavailable", async () => {
    const store = new AnalysisStore(null);
    expect(await store.set([])).toBe(false);
    expect(await store.get()).toEqual([]);
  });
});
