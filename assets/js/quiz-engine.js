import { QUESTION_DIFFICULTIES } from "./constants.js";
import { shuffle, uniqueById } from "./utils.js";

function getSelectedDifficultySet(settings) {
  if (Array.isArray(settings.selectedDifficulties)) {
    return new Set(
      settings.selectedDifficulties.filter((difficulty) =>
        QUESTION_DIFFICULTIES.includes(difficulty)
      )
    );
  }

  if (QUESTION_DIFFICULTIES.includes(settings.difficulty)) {
    return new Set([settings.difficulty]);
  }

  return new Set(QUESTION_DIFFICULTIES);
}

function difficultyMatch(question, selectedDifficulties) {
  return selectedDifficulties.has(question.difficulty);
}

function getVerseKey(question) {
  return `${question.bookId}:${question.chapter}:${question.startVerse}`;
}

function chapterKey(bookId, chapter) {
  return `${bookId}:${chapter}`;
}

function questionMatchesSelectedVerses(question, selectedVerseSets) {
  const verses = selectedVerseSets.get(chapterKey(question.bookId, question.chapter));
  if (!verses) {
    return true;
  }

  if (verses.size === 0) {
    return false;
  }

  const start = Number(question.startVerse) || 0;
  const end = Number(question.endVerse) || start;
  const lower = Math.max(1, Math.min(start, end));
  const upper = Math.max(start, end, lower);

  for (let verse = lower; verse <= upper; verse += 1) {
    if (verses.has(verse)) {
      return true;
    }
  }

  return false;
}

function buildCandidateStats(candidates) {
  return {
    questionCount: candidates.length,
    bookCount: new Set(candidates.map((question) => question.bookId)).size,
  };
}

export async function generateQuestions({
  dataService,
  year,
  selectedScope,
  selectedVerses,
  settings,
  seed,
}) {
  const typeSet = new Set(settings.selectedTypes);
  const difficultySet = getSelectedDifficultySet(settings);
  const unmet = [];
  const chapterPairs = [];

  for (const [bookId, chapters] of Object.entries(selectedScope)) {
    for (const chapter of chapters) {
      chapterPairs.push({ bookId, chapter });
    }
  }

  if (chapterPairs.length === 0) {
    return {
      questions: [],
      unmet: ["No books/chapters selected for the active year."],
      stats: { questionCount: 0, bookCount: 0 },
    };
  }

  const loaded = await Promise.all(
    chapterPairs.map(({ bookId, chapter }) => dataService.loadChapter(bookId, chapter))
  );

  let candidates = uniqueById(loaded.flat());

  const selectedVerseSets = new Map();
  for (const [key, verses] of Object.entries(selectedVerses || {})) {
    if (!Array.isArray(verses)) {
      continue;
    }

    selectedVerseSets.set(
      key,
      new Set(
        verses
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0)
      )
    );
  }

  candidates = candidates.filter((question) => questionMatchesSelectedVerses(question, selectedVerseSets));

  if (settings.humanReviewedOnly) {
    candidates = candidates.filter((question) => question.validatedBy === "human");
  }

  candidates = candidates.filter((question) => typeSet.has(question.type));
  candidates = candidates.filter((question) => difficultyMatch(question, difficultySet));
  const stats = buildCandidateStats(candidates);

  if (candidates.length === 0) {
    return {
      questions: [],
      unmet: ["No questions match the current filters. Try widening type, difficulty, or review filters."],
      stats,
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

  if (!year) {
    unmet.push("Year mapping not found. Default scope used.");
  }

  return {
    questions: selected,
    unmet,
    stats,
  };
}
