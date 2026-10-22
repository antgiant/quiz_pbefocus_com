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
