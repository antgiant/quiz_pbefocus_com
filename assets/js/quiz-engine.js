import { QUESTION_DIFFICULTIES, questionTypeGroupId } from "./constants.js";
import { questionMatchesSelectedSources, shuffle, uniqueById } from "./utils.js";

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

function selectUnweighted(randomized, settings, perVerseCounts = new Map()) {
  const selected = [];

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

  return selected;
}

// Returns Map(chapterKey -> weight) or null when the user set no percentages.
// Blank chapters split whatever percent the explicit ones leave over, evenly.
function resolveChapterWeights(candidates, selectedScope, chapterWeights) {
  const keys = [];
  for (const [bookId, chapters] of Object.entries(selectedScope)) {
    for (const chapter of chapters) {
      keys.push(chapterKey(bookId, chapter));
    }
  }

  const explicit = new Map();
  for (const key of keys) {
    const value = Number(chapterWeights?.[key]);
    if (chapterWeights && key in chapterWeights && Number.isFinite(value) && value >= 0) {
      explicit.set(key, value);
    }
  }

  if (explicit.size === 0) {
    return null;
  }

  const blank = keys.filter((key) => !explicit.has(key));
  const explicitTotal = [...explicit.values()].reduce((sum, value) => sum + value, 0);
  const blankShare = blank.length ? Math.max(0, 100 - explicitTotal) / blank.length : 0;

  const weights = new Map(explicit);
  for (const key of blank) {
    weights.set(key, blankShare);
  }

  return weights;
}

// Repeatedly take from the chapter furthest below its target share, which
// yields the requested mix and hands unfilled quota to chapters that still
// have questions left.
function selectWeighted(randomized, weights, settings, seed, perVerseCounts = new Map()) {
  const queues = new Map();
  for (const question of randomized) {
    const key = chapterKey(question.bookId, question.chapter);
    if (!(weights.get(key) > 0)) {
      continue;
    }
    if (!queues.has(key)) {
      queues.set(key, []);
    }
    queues.get(key).push(question);
  }

  const selected = [];
  const counts = new Map();

  while (selected.length < settings.totalCount) {
    let bestKey = null;
    let bestRatio = Infinity;

    for (const [key, queue] of queues) {
      while (queue.length) {
        const verseKey = getVerseKey(queue[0]);
        if ((perVerseCounts.get(verseKey) || 0) < settings.perVerse) {
          break;
        }
        queue.shift();
      }

      if (!queue.length) {
        continue;
      }

      const ratio = (counts.get(key) || 0) / weights.get(key);
      if (ratio < bestRatio) {
        bestRatio = ratio;
        bestKey = key;
      }
    }

    if (bestKey === null) {
      break;
    }

    const question = queues.get(bestKey).shift();
    const verseKey = getVerseKey(question);
    selected.push(question);
    counts.set(bestKey, (counts.get(bestKey) || 0) + 1);
    perVerseCounts.set(verseKey, (perVerseCounts.get(verseKey) || 0) + 1);
  }

  return shuffle(selected, seed);
}

// Returns Map(difficulty -> share of the quiz, summing to 1) or null when the
// user is not assigning percentages. Blank difficulties split what is left evenly.
function resolveDifficultyWeights(difficultySet, settings) {
  if (!settings.useDifficultyWeights) {
    return null;
  }

  const difficulties = QUESTION_DIFFICULTIES.filter((difficulty) => difficultySet.has(difficulty));
  const explicit = new Map();
  for (const difficulty of difficulties) {
    const value = Number(settings.difficultyWeights?.[difficulty]);
    if (settings.difficultyWeights?.[difficulty] != null && Number.isFinite(value) && value >= 0) {
      explicit.set(difficulty, value);
    }
  }

  if (explicit.size === 0) {
    return null;
  }

  const blank = difficulties.filter((difficulty) => !explicit.has(difficulty));
  const explicitTotal = [...explicit.values()].reduce((sum, value) => sum + value, 0);
  const blankShare = blank.length ? Math.max(0, 100 - explicitTotal) / blank.length : 0;
  const raw = new Map(explicit);
  for (const difficulty of blank) {
    raw.set(difficulty, blankShare);
  }

  const total = [...raw.values()].reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) {
    return null;
  }
  return new Map([...raw].map(([difficulty, value]) => [difficulty, value / total]));
}

// Whole-question targets per difficulty that add up to totalCount (largest remainder)
function difficultyTargets(shares, totalCount) {
  const targets = new Map();
  const remainders = [];
  let assigned = 0;
  for (const [difficulty, share] of shares) {
    const exact = share * totalCount;
    const whole = Math.floor(exact);
    targets.set(difficulty, whole);
    assigned += whole;
    remainders.push({ difficulty, fraction: exact - whole });
  }
  remainders.sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; assigned < totalCount && i < remainders.length; i += 1, assigned += 1) {
    targets.set(remainders[i].difficulty, targets.get(remainders[i].difficulty) + 1);
  }
  return targets;
}

export async function generateQuestions({
  dataService,
  year,
  selectedScope,
  selectedVerses,
  chapterWeights,
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

  candidates = candidates.filter((question) =>
    questionMatchesSelectedSources(question, settings.selectedSources)
  );

  candidates = candidates.filter((question) => typeSet.has(questionTypeGroupId(question.type)));
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
  const weights = resolveChapterWeights(randomized, selectedScope, chapterWeights);
  const pick = (pool, count, perVerseCounts) => {
    const limited = { ...settings, totalCount: count };
    return weights
      ? selectWeighted(pool, weights, limited, seed, perVerseCounts)
      : selectUnweighted(pool, limited, perVerseCounts);
  };

  const difficultyShares = resolveDifficultyWeights(difficultySet, settings);
  let selected;
  if (difficultyShares) {
    const perVerseCounts = new Map();
    selected = [];
    for (const [difficulty, target] of difficultyTargets(difficultyShares, settings.totalCount)) {
      const pool = randomized.filter((question) => question.difficulty === difficulty);
      selected.push(...pick(pool, target, perVerseCounts));
    }

    // Top up from any selected difficulty when a share runs out of questions
    if (selected.length < settings.totalCount) {
      const chosen = new Set(selected);
      const rest = randomized.filter((question) => !chosen.has(question));
      const extra = pick(rest, settings.totalCount - selected.length, perVerseCounts);
      if (extra.length) {
        unmet.push("Not enough questions to match the difficulty percentages exactly; other difficulties filled in.");
      }
      selected.push(...extra);
    }
    selected = shuffle(selected, seed);
  } else {
    selected = pick(randomized, settings.totalCount, new Map());
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
