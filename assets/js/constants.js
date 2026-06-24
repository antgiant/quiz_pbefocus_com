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

export const DIFFICULTY_POINTS_MAP = {
  easy: [1],
  medium: [2],
  hard: [5],
};

export const STORAGE_KEY = "pbe_quiz_profiles_v1";

export const DEFAULT_PERSON_NAME = "Person 1";

export const DEFAULT_SETTINGS = {
  mode: "print",
  yearId: "current-year",
  totalCount: 25,
  perVerse: 2,
  difficulty: "all",
  humanReviewedOnly: false,
  selectedTypes: [...QUESTION_TYPES],
};
