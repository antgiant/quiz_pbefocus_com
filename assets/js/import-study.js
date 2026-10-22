// Brings presets over from the PBE Study Tool (pbe.wooleys.us). The study tool
// links here with its presets encoded in the URL hash (#import=...), because the
// two sites can't read each other's storage.

import { DEFAULT_FILL_IN_BLANK, DEFAULT_SETTINGS, QUESTION_DIFFICULTIES } from "./constants.js";

const CUSTOM_YEAR_ID = "custom-all";
export const IMPORT_SCHEMA = "pbe.study.export.v1";
const MAX_HASH_LENGTH = 400000;
const MAX_PRESETS = 50;
const MAX_NAME_LENGTH = 60;
const MAX_TOTAL_COUNT = 100;

function base64UrlToText(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// Returns the study tool's export, or null when the hash holds none (or it is malformed)
export function decodeImportHash(hash) {
  const match = /^#?import=([A-Za-z0-9_-]+)$/.exec(String(hash || ""));
  if (!match || match[1].length > MAX_HASH_LENGTH) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlToText(match[1]));
    if (payload?.schema !== IMPORT_SCHEMA || !Array.isArray(payload.presets)) {
      return null;
    }
    const presets = payload.presets
      .filter((preset) => preset && typeof preset === "object" && Array.isArray(preset.activeChapters))
      .slice(0, MAX_PRESETS);
    return presets.length ? { schema: IMPORT_SCHEMA, presets } : null;
  } catch {
    return null;
  }
}

function positiveInt(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 1 ? number : fallback;
}

// Study tool books are numbered (41 = Mark); quiz books are "41-mark"
function bookIdByNumber(manifest) {
  return new Map(
    (manifest.books || []).map((book) => [String(book.id).split("-")[0], book])
  );
}

export function studyPresetToProfile(preset, { manifest, years = [], name }) {
  const books = bookIdByNumber(manifest);
  const selectedScope = {};
  const selectedVerses = {};
  let verseTotal = 0;

  for (const key of preset.activeChapters) {
    const [bookNumber, chapterText] = String(key).split(",");
    const book = books.get(bookNumber);
    const chapter = Number(chapterText);
    const chapterInfo = book?.chapters.find((item) => item.number === chapter);
    if (!book || !chapterInfo) {
      continue;
    }

    const selection = preset.verseSelections?.[key];
    const chosen =
      selection && selection.allSelected === false && Array.isArray(selection.selectedVerses)
        ? [...new Set(selection.selectedVerses.map(Number).filter((v) => Number.isInteger(v) && v > 0))].sort(
            (a, b) => a - b
          )
        : null;
    if (chosen && chosen.length === 0) {
      continue;
    }

    (selectedScope[book.id] = selectedScope[book.id] || []).push(chapter);
    if (chosen) {
      selectedVerses[`${book.id}:${chapter}`] = chosen;
      verseTotal += chosen.length;
    } else {
      verseTotal += Number(chapterInfo.verses) || 0;
    }
  }

  for (const chapters of Object.values(selectedScope)) {
    chapters.sort((a, b) => a - b);
  }

  // The study tool only ever blanked a fixed number or percent, so keep it exact
  const fillInBlank = preset.useOnlyPercentage
    ? {
        ...DEFAULT_FILL_IN_BLANK,
        mode: "custom",
        unit: "percent",
        minPercent: Math.min(100, positiveInt(preset.maxBlankPercentage, 100)),
        maxPercent: Math.min(100, positiveInt(preset.maxBlankPercentage, 100)),
      }
    : {
        ...DEFAULT_FILL_IN_BLANK,
        mode: "custom",
        unit: "count",
        minBlanks: positiveInt(preset.minBlanks, 1),
        maxBlanks: Math.max(positiveInt(preset.minBlanks, 1), positiveInt(preset.maxBlanks, 1)),
      };

  // Keep the season when it covers every chosen chapter; otherwise fall back to the
  // custom year (the study tool allowed any chapter with any season)
  const covers = (year) =>
    Object.entries(selectedScope).every(([bookId, chapters]) =>
      chapters.every((chapter) => year.scope?.[bookId]?.includes(chapter))
    );
  const season = years.find((year) => year.id === preset.year);
  const yearId = season && covers(season) ? season.id : years.find((year) => year.id === CUSTOM_YEAR_ID)?.id || years[0]?.id;

  return {
    id: crypto.randomUUID(),
    name: String(name || "Study tool").slice(0, MAX_NAME_LENGTH),
    settings: {
      ...DEFAULT_SETTINGS,
      yearId: yearId || DEFAULT_SETTINGS.yearId,
      // The study tool showed every selected verse once, so do the same
      totalCount: Math.max(1, Math.min(MAX_TOTAL_COUNT, verseTotal || DEFAULT_SETTINGS.totalCount)),
      perVerse: 1,
      selectedTypes: ["fill_in_blank"],
      selectedDifficulties: [...QUESTION_DIFFICULTIES],
      typeWeights: {},
      difficultyWeights: {},
      fillInBlank,
      selectorMode: preset.activeSelector === "verse" ? "verse" : "chapter",
    },
    selectedScope,
    selectedVerses,
  };
}

// Presets with nothing selected are skipped; names are made unique among `existingNames`
export function studyPresetsToProfiles(payload, { manifest, years, existingNames = [] }) {
  const taken = new Set(existingNames.map((name) => name.toLowerCase()));
  const profiles = [];

  payload.presets.forEach((preset, index) => {
    const base =
      String(preset.name || "").trim() && preset.id !== "preset-none"
        ? String(preset.name).trim()
        : index === 0
          ? "Study tool settings"
          : `Study tool ${index + 1}`;

    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n += 1) {
      name = `${base} (${n})`;
    }

    const profile = studyPresetToProfile(preset, { manifest, years, name });
    if (!Object.keys(profile.selectedScope).length) {
      return;
    }
    taken.add(name.toLowerCase());
    profiles.push(profile);
  });

  return profiles;
}
