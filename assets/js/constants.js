export const QUESTION_TYPES = [
  "who",
  "what",
  "where",
  "why",
  "how_many",
  "list",
  "true_false",
  "other",
];

export const QUESTION_DIFFICULTIES = ["easy", "medium", "hard"];

export const QUESTION_SOURCES = [
  "ai_unreviewed",
  "ai_human_reviewed",
  "human_generated",
];

export const STORAGE_KEY = "pbe_quiz_profiles_v1";

export const DEFAULT_PERSON_NAME = "Person 1";

export const DEFAULT_SETTINGS = {
  mode: "print",
  yearId: "current-year",
  totalCount: 25,
  perVerse: 2,
  selectedDifficulties: [...QUESTION_DIFFICULTIES],
  selectedSources: [...QUESTION_SOURCES],
  selectedTypes: [...QUESTION_TYPES],
};

// Audio cues for the PowerPoint timer. `ms` is the clip length, used for the
// slide's play command; `tenSeconds` plays at 10 s left and `timesUp` at 0.
export const AUDIO_STYLES = {
  classic: {
    label: "Classic",
    tenSeconds: { path: "assets/audio/classic/10-seconds.mp3", ms: 1970 },
    timesUp: { path: "assets/audio/classic/times-up.mp3", ms: 4560 },
  },
};

export const DEFAULT_AUDIO_STYLE = "classic";
