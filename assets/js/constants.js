export const QUESTION_TYPES = [
  "who",
  "what",
  "where",
  "why",
  "how_many",
  "list",
  "true_false",
  "fill_in_blank",
  "other",
];

// The question types offered in the UI; each groups the raw data types above
export const QUESTION_TYPE_GROUPS = [
  {
    id: "short_answer",
    label: "Short Answer",
    types: ["who", "what", "where", "why", "how_many", "list", "other"],
  },
  { id: "fill_in_blank", label: "Fill in the Blank", types: ["fill_in_blank"] },
  { id: "true_false", label: "True/False", types: ["true_false"] },
];

export const QUESTION_TYPE_GROUP_IDS = QUESTION_TYPE_GROUPS.map((group) => group.id);

export function questionTypeGroupId(type) {
  return QUESTION_TYPE_GROUPS.find((group) => group.types.includes(type))?.id || "short_answer";
}

// Saved profiles may hold raw types from before grouping; map them to group ids
export function normalizeSelectedTypeGroups(selectedTypes) {
  if (!Array.isArray(selectedTypes)) {
    return [...QUESTION_TYPE_GROUP_IDS];
  }
  const groups = new Set(selectedTypes.map((type) =>
    QUESTION_TYPE_GROUP_IDS.includes(type) ? type : questionTypeGroupId(type)
  ));
  return QUESTION_TYPE_GROUP_IDS.filter((id) => groups.has(id));
}

// The one-choice "style" of the simple setup screen; each is a set of the type groups above
export const QUIZ_STYLES = [
  { id: "mixed", label: "Mixed (recommended)", types: [...QUESTION_TYPE_GROUP_IDS] },
  { id: "fill_in_blank", label: "Fill in the blank only", types: ["fill_in_blank"] },
  { id: "short_answer", label: "Short answer only", types: ["short_answer"] },
];

// Which style matches the selected types, or "custom" when advanced setup picked something else
export function quizStyleForTypes(selectedTypes) {
  const chosen = new Set(selectedTypes || []);
  const match = QUIZ_STYLES.find(
    (style) => style.types.length === chosen.size && style.types.every((type) => chosen.has(type))
  );
  return match ? match.id : "custom";
}

export const QUESTION_DIFFICULTIES = ["easy", "medium", "hard"];

export const QUESTION_SOURCES = [
  "ai_unreviewed",
  "ai_human_reviewed",
  "human_generated",
];

// What to do with the person's own questions (see custom-questions.js): mix them in with the
// rest, use only them, or leave them out
export const OWN_QUESTION_MODES = [
  { id: "include", label: "All questions, mine included" },
  { id: "only", label: "Only my own questions" },
  { id: "exclude", label: "Leave my own questions out" },
];

export function normalizeOwnQuestionMode(mode) {
  return OWN_QUESTION_MODES.some((option) => option.id === mode) ? mode : "include";
}

// Where "share my questions" opens a GitHub issue
export const SHARE_REPO = "antgiant/quiz_pbefocus_com";

export const STORAGE_KEY = "pbe_quiz_profiles_v1";

export const DEFAULT_PERSON_NAME = "Person 1";

// Generated fill-in-the-blank questions. "difficulty" mode blanks easy up to 20%
// of a verse's words, medium over 20-40% and hard over 40-80%; "custom" overrides
// that with a number of blanks or a percent of the words.
export const DEFAULT_FILL_IN_BLANK = {
  mode: "difficulty",
  unit: "count",
  minBlanks: 1,
  maxBlanks: 3,
  minPercent: 10,
  maxPercent: 40,
};

export const DEFAULT_SETTINGS = {
  mode: "print",
  yearId: "current-year",
  totalCount: 25,
  perVerse: 2,
  selectedDifficulties: [...QUESTION_DIFFICULTIES],
  selectedSources: [...QUESTION_SOURCES],
  ownQuestions: "include",
  selectedTypes: [...QUESTION_TYPE_GROUP_IDS],
  difficultyWeights: {},
  typeWeights: {},
  fillInBlank: { ...DEFAULT_FILL_IN_BLANK },
};

// Audio cues for the PowerPoint and interactive timers (the ?v= suffix busts caches when a
// file changes). `tenSeconds` plays at 10 s left and `timesUp` at 0; the `final*` pair plays
// instead on the last question. `ms` is the clip length, used for the slide's play command.
export const AUDIO_STYLES = {
  classic: {
    label: "Classic",
    tenSeconds: { path: "assets/audio/classic/10-seconds.mp3?v=3", ms: 1970 },
    timesUp: { path: "assets/audio/classic/times-up.mp3?v=3", ms: 4560 },
    finalTenSeconds: { path: "assets/audio/classic/10-seconds-final.mp3?v=3", ms: 3800 },
    finalTimesUp: { path: "assets/audio/classic/times-up-final.mp3?v=3", ms: 13800 },
  },
};

export const AUDIO_CUE_KEYS = ["tenSeconds", "timesUp", "finalTenSeconds", "finalTimesUp"];

// The cue to use for a base cue ("tenSeconds" / "timesUp") on the last question or not
export function audioCueKey(baseKind, isLast) {
  return isLast ? `final${baseKind[0].toUpperCase()}${baseKind.slice(1)}` : baseKind;
}

export const DEFAULT_AUDIO_STYLE = "classic";

// Interactive and PowerPoint timer presets, in seconds
export const TIMER_PRESETS = {
  florida: { first: 10, additional: 5 },
  // The NAD competition runs on Nearpod, which times in 15 s steps. Measured from the 2025 and 2026
  // broadcasts (98 questions): 1-2 points ran 30 s, 3-5 points 45 s, 6-7 points 60 s, which is
  // 30 s plus 5 s per extra point rounded to the nearest step (86% of questions; 30 s plus 10 s,
  // rounded mostly up, fit 59%). NAD reads each question in English and Spanish, so its reading
  // time before the clock starts is twice a state test's (see reading-time.js).
  nad: { first: 30, additional: 5, roundTo: 15, roundMode: "nearest", bilingual: true },
};

// Timer choice saved before Nearpod and NAD became one preset
export const LEGACY_TIMER_MODES = { nearpod: "nad" };
