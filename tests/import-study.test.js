import { describe, expect, it } from "vitest";
import {
  IMPORT_SCHEMA,
  decodeImportHash,
  studyPresetToProfile,
  studyPresetsToProfiles,
} from "../assets/js/import-study.js";

function encode(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const manifest = {
  books: [
    { id: "41-mark", name: "Mark", chapters: [{ number: 1, verses: 45 }, { number: 2, verses: 28 }] },
    { id: "8-ruth", name: "Ruth", chapters: [{ number: 0, verses: 3 }, { number: 1, verses: 22 }] },
  ],
};
const years = [
  { id: "2019-2020", name: "2019-2020", scope: { "41-mark": [1, 2] } },
  { id: "custom-all", name: "Custom - Entire Bible", scope: { "41-mark": [1, 2], "8-ruth": [0, 1] } },
];

const preset = (overrides = {}) => ({
  id: "p1",
  name: "Mark study",
  year: "2019-2020",
  activeChapters: ["41,1", "41,2"],
  verseSelections: {},
  activeSelector: "chapter",
  minBlanks: 2,
  maxBlanks: 4,
  maxBlankPercentage: 100,
  useOnlyPercentage: false,
  ...overrides,
});

describe("decodeImportHash", () => {
  it("reads the study tool's export", () => {
    const payload = { schema: IMPORT_SCHEMA, presets: [preset()] };
    expect(decodeImportHash(`#import=${encode(payload)}`)).toEqual(payload);
  });

  it.each([
    ["", "empty"],
    ["#other=abc", "other hash"],
    ["#import=%%%", "bad characters"],
    ["#import=bm90IGpzb24", "not json"],
    [`#import=${encode({ schema: "other", presets: [preset()] })}`, "wrong schema"],
    [`#import=${encode({ schema: IMPORT_SCHEMA, presets: [] })}`, "no presets"],
    [`#import=${encode({ schema: IMPORT_SCHEMA, presets: [{ name: "x" }] })}`, "no chapters"],
  ])("ignores %s (%s)", (hash) => {
    expect(decodeImportHash(hash)).toBeNull();
  });

  it("limits how many presets it accepts", () => {
    const payload = { schema: IMPORT_SCHEMA, presets: Array.from({ length: 80 }, () => preset()) };
    expect(decodeImportHash(`#import=${encode(payload)}`).presets).toHaveLength(50);
  });

  it("round-trips unicode", () => {
    const payload = { schema: IMPORT_SCHEMA, presets: [preset({ name: "Génesis ✝" })] };
    expect(decodeImportHash(`#import=${encode(payload)}`).presets[0].name).toBe("Génesis ✝");
  });
});

describe("studyPresetToProfile", () => {
  it("maps chapters, verses and blank counts", () => {
    const profile = studyPresetToProfile(
      preset({
        activeSelector: "verse",
        verseSelections: {
          "41,1": { allSelected: false, selectedVerses: [3, 1, 2, 2] },
          "41,2": { allSelected: true, selectedVerses: [] },
        },
      }),
      { manifest, years, name: "Mark study" }
    );

    expect(profile.name).toBe("Mark study");
    expect(profile.selectedScope).toEqual({ "41-mark": [1, 2] });
    expect(profile.selectedVerses).toEqual({ "41-mark:1": [1, 2, 3] });
    expect(profile.settings).toMatchObject({
      yearId: "2019-2020",
      selectedTypes: ["fill_in_blank"],
      perVerse: 1,
      selectorMode: "verse",
      // 3 chosen verses + the whole of chapter 2
      totalCount: 31,
      fillInBlank: { mode: "custom", unit: "count", minBlanks: 2, maxBlanks: 4 },
    });
  });

  it("turns 'use only percentage' into an exact percent", () => {
    const profile = studyPresetToProfile(preset({ useOnlyPercentage: true, maxBlankPercentage: 30 }), {
      manifest,
      years,
      name: "x",
    });
    expect(profile.settings.fillInBlank).toMatchObject({ unit: "percent", minPercent: 30, maxPercent: 30 });
  });

  it("keeps intro chapters", () => {
    const profile = studyPresetToProfile(preset({ activeChapters: ["8,0", "8,1"], year: "custom-all" }), {
      manifest,
      years,
      name: "x",
    });
    expect(profile.selectedScope).toEqual({ "8-ruth": [0, 1] });
  });

  it("falls back to the custom year when the season does not cover the chapters", () => {
    const profile = studyPresetToProfile(preset({ activeChapters: ["8,1"], year: "2019-2020" }), {
      manifest,
      years,
      name: "x",
    });
    expect(profile.settings.yearId).toBe("custom-all");
  });

  it("uses the custom year for the study tool's 'custom-all' season", () => {
    const profile = studyPresetToProfile(preset({ year: "custom-all" }), { manifest, years, name: "x" });
    expect(profile.settings.yearId).toBe("custom-all");
  });

  it("skips chapters and books it does not know and empty verse picks", () => {
    const profile = studyPresetToProfile(
      preset({
        activeChapters: ["41,1", "41,9", "99,1", "41,2"],
        verseSelections: { "41,2": { allSelected: false, selectedVerses: [] } },
      }),
      { manifest, years, name: "x" }
    );
    expect(profile.selectedScope).toEqual({ "41-mark": [1] });
  });

  it("repairs odd blank settings", () => {
    const profile = studyPresetToProfile(preset({ minBlanks: 5, maxBlanks: 2 }), { manifest, years, name: "x" });
    expect(profile.settings.fillInBlank).toMatchObject({ minBlanks: 5, maxBlanks: 5 });
    const junk = studyPresetToProfile(preset({ minBlanks: "x", maxBlanks: null }), { manifest, years, name: "x" });
    expect(junk.settings.fillInBlank).toMatchObject({ minBlanks: 1, maxBlanks: 1 });
  });

  it("caps the quiz length", () => {
    const many = studyPresetToProfile(preset(), {
      manifest: { books: [{ id: "1-x", name: "X", chapters: [{ number: 1, verses: 500 }] }] },
      years: [],
      name: "x",
      ...{},
    });
    expect(many.settings.totalCount).toBeLessThanOrEqual(100);
  });
});

describe("studyPresetsToProfiles", () => {
  it("names presets, de-duplicates names and skips empty ones", () => {
    const payload = {
      schema: IMPORT_SCHEMA,
      presets: [
        preset({ id: "preset-none", name: "None" }),
        preset({ name: "Mark study" }),
        preset({ name: "Mark study" }),
        preset({ name: "Nothing", activeChapters: ["99,9"] }),
        preset({ name: "  ", id: "p4" }),
      ],
    };
    const profiles = studyPresetsToProfiles(payload, { manifest, years, existingNames: ["mark study"] });
    expect(profiles.map((profile) => profile.name)).toEqual([
      "Study tool settings",
      "Mark study (2)",
      "Mark study (3)",
      "Study tool 5",
    ]);
    expect(new Set(profiles.map((profile) => profile.id)).size).toBe(profiles.length);
  });
});
