import { DIFFICULTY_POINTS_MAP } from "./constants.js";
import { shuffle, uniqueById } from "./utils.js";

function difficultyMatch(question, difficulty) {
  if (difficulty === "all") {
    return true;
  }

  const allowedPoints = DIFFICULTY_POINTS_MAP[difficulty] || [];
  return allowedPoints.includes(question.points);
}

function getVerseKey(question) {
  return `${question.bookId}:${question.chapter}:${question.startVerse}`;
}

export async function generateQuestions({
  dataService,
  year,
  selectedScope,
  settings,
  seed,
}) {
  const typeSet = new Set(settings.selectedTypes);
  const unmet = [];
  const chapterPairs = [];

  for (const [bookId, chapters] of Object.entries(selectedScope)) {
    for (const chapter of chapters) {
      chapterPairs.push({ bookId, chapter });
    }
  }

  if (chapterPairs.length === 0) {
    return { questions: [], unmet: ["No books/chapters selected for the active year."] };
  }

  const loaded = await Promise.all(
    chapterPairs.map(({ bookId, chapter }) => dataService.loadChapter(bookId, chapter))
  );

  let candidates = uniqueById(loaded.flat());

  if (settings.humanReviewedOnly) {
    candidates = candidates.filter((question) => question.validatedBy === "human");
  }

  candidates = candidates.filter((question) => typeSet.has(question.type));
  candidates = candidates.filter((question) => difficultyMatch(question, settings.difficulty));

  if (candidates.length === 0) {
    return {
      questions: [],
      unmet: ["No questions match the current filters. Try widening type, difficulty, or review filters."],
    };
  }

  const randomized = shuffle(candidates, seed);
  const selected = [];
  const perVerseCounts = new Map();

  for (const question of randomized) {
    const verseKey = getVerseKey(question);
    const verseCount = perVerseCounts.get(verseKey) || 0;

    if (verseCount >= settings.perVerse) {
      continue;
    }

    selected.push(question);
    perVerseCounts.set(verseKey, verseCount + 1);

    if (selected.length >= settings.totalCount) {
      break;
    }
  }

  if (selected.length < settings.totalCount) {
    unmet.push(
      `Requested ${settings.totalCount} questions, but only ${selected.length} satisfy all constraints.`
    );
  }

  if (settings.difficulty !== "all") {
    unmet.push("Difficulty is currently inferred from points until explicit metadata is added.");
  }

  if (!year) {
    unmet.push("Year mapping not found. Default scope used.");
  }

  return {
    questions: selected,
    unmet,
  };
}
