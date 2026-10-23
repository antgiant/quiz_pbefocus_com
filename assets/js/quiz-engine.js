import { DEFAULT_FILL_IN_BLANK, QUESTION_DIFFICULTIES, QUESTION_TYPE_GROUP_IDS, questionTypeGroupId } from "./constants.js";
import {
  buildBlankedVerse,
  buildTfidfContext,
  difficultyForPercent,
  hasAnalysis,
  hashString,
  makeRng,
  pickBandBlankCount,
  pickCustomBlankCount,
  segmentsToAnswerText,
  segmentsToText,
  wordCountOf,
} from "./blank-engine.js";
import { formatFillInBlankLead } from "./question-formatters.js";
import { loadVendor } from "./lazy-vendor.js";
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

// Returns Map(key -> share of the quiz, summing to 1) or null when the user is
// not assigning percentages. Blank entries split what is left evenly.
function resolveShares(keys, weights) {
  const explicit = new Map();
  for (const key of keys) {
    const value = Number(weights?.[key]);
    if (weights?.[key] != null && Number.isFinite(value) && value >= 0) {
      explicit.set(key, value);
    }
  }

  if (explicit.size === 0) {
    return null;
  }

  const blank = keys.filter((key) => !explicit.has(key));
  const explicitTotal = [...explicit.values()].reduce((sum, value) => sum + value, 0);
  const blankShare = blank.length ? Math.max(0, 100 - explicitTotal) / blank.length : 0;
  const raw = new Map(explicit);
  for (const key of blank) {
    raw.set(key, blankShare);
  }

  const total = [...raw.values()].reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) {
    return null;
  }
  return new Map([...raw].map(([key, value]) => [key, value / total]));
}

function resolveDifficultyWeights(difficultySet, settings) {
  return resolveShares(
    QUESTION_DIFFICULTIES.filter((difficulty) => difficultySet.has(difficulty)),
    settings.difficultyWeights
  );
}

function resolveTypeWeights(typeSet, settings) {
  const groups = QUESTION_TYPE_GROUP_IDS.filter((group) => typeSet.has(group));
  return groups.length > 1 ? resolveShares(groups, settings.typeWeights) : null;
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

// --- Generated fill-in-the-blank questions ---

const FIB_TYPE = "fill_in_blank";

function fillInBlankSettings(settings) {
  return { ...DEFAULT_FILL_IN_BLANK, ...(settings.fillInBlank || {}) };
}

// One lightweight candidate per verse (and per selected difficulty in
// difficulty mode). The blanks themselves are only chosen for the questions
// that get picked, so scanning a whole book stays cheap.
function fillInBlankCandidates({ pair, verses, bookName, selectedVerseSets, difficultySet, config, seed }) {
  const key = chapterKey(pair.bookId, pair.chapter);
  const allowed = selectedVerseSets.get(key);
  const candidates = [];
  const pool = [];

  for (const verse of verses) {
    if (allowed && !allowed.has(Number(verse.verse))) {
      continue;
    }

    const words = wordCountOf(verse.text);
    if (words < 2) {
      continue;
    }

    const verseId = `${pair.bookId}:${pair.chapter}:${verse.verse}`;
    pool.push({ id: verseId, chapterKey: key, text: verse.text });

    const make = (difficulty, count) => ({
      id: `fib-${verseId}-${difficulty}`,
      type: FIB_TYPE,
      generated: true,
      bookId: pair.bookId,
      book: bookName,
      chapter: pair.chapter,
      startVerse: Number(verse.verse),
      endVerse: Number(verse.verse),
      refLabel: pair.chapter === 0 ? `${bookName} Intro: ${verse.label}` : undefined,
      difficulty,
      points: count,
      blankCount: count,
      verseId,
      chapterKey: key,
      verseText: verse.text,
      validatedBy: "generated",
      createdBy: "pbe-quiz-generator",
      question: "",
      answer: "",
    });

    if (config.mode === "custom") {
      const rng = makeRng(hashString(`${seed}:${verseId}:custom`));
      const count = pickCustomBlankCount(words, config, rng);
      if (count) {
        candidates.push(make(difficultyForPercent((count / words) * 100), count));
      }
      continue;
    }

    for (const difficulty of QUESTION_DIFFICULTIES) {
      if (!difficultySet.has(difficulty)) {
        continue;
      }
      const rng = makeRng(hashString(`${seed}:${verseId}:${difficulty}`));
      const count = pickBandBlankCount(words, difficulty, rng);
      if (count) {
        candidates.push(make(difficulty, count));
      }
    }
  }

  return { candidates, pool };
}

// Choose the blanked words for generated questions and write the question and
// answer text. Everything downstream (preview, print, PowerPoint, interactive)
// reads this one result, so all outputs show the same blanks.
export function finalizeFillInBlank(questions, context, seed) {
  return questions.map((question) => {
    if (!question.generated || question.type !== FIB_TYPE) {
      return question;
    }

    const rng = makeRng(hashString(`${seed}:${question.id}:blanks`));
    const { segments, words } = buildBlankedVerse({
      text: question.verseText,
      count: question.blankCount,
      scores: {
        verse: context?.verseLevel?.[question.verseId],
        chapter: context?.chapterLevel?.[question.chapterKey],
      },
      rng,
    });

    const points = Math.max(1, words.length);
    const finished = { ...question, segments, blankWords: words, points };
    return {
      ...finished,
      question: `${formatFillInBlankLead(finished)} ${segmentsToText(segments)}`,
      answer: words.join("; "),
      fullText: segmentsToAnswerText(segments),
    };
  });
}

// Same verses, freshly chosen blanks (the interactive quiz's "practice again")
export function reblankQuestions(questions, context, seed) {
  return finalizeFillInBlank(questions, context, seed);
}

// With no percentages set, each type's share follows how many questions it has,
// but generated fill-in-the-blank counts once per verse rather than once per
// difficulty, so it doesn't crowd out the written questions
function naturalTypeShares(candidates, verseCount) {
  if (!verseCount) {
    return null;
  }

  const counts = new Map();
  for (const question of candidates) {
    if (!question.generated) {
      const group = questionTypeGroupId(question.type);
      counts.set(group, (counts.get(group) || 0) + 1);
    }
  }
  if (counts.size === 0) {
    return null;
  }

  counts.set(FIB_TYPE, verseCount);
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return new Map([...counts].map(([group, count]) => [group, count / total]));
}

export async function generateQuestions({
  dataService,
  year,
  selectedScope,
  selectedVerses,
  chapterWeights,
  settings,
  seed,
  onProgress = null,
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

  // One request for the whole season, rather than one per chapter
  await dataService.loadYearPack?.(year);

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

  // Generated fill-in-the-blank questions come from the verse text itself
  let versePool = [];
  if (typeSet.has(FIB_TYPE) && difficultySet.size > 0) {
    const config = fillInBlankSettings(settings);
    let done = 0;
    const failed = [];
    const chapterVerses = await Promise.all(
      chapterPairs.map(async (pair) => {
        const verses = await dataService.loadNkjvChapterWithRetry(pair.bookId, pair.chapter);
        done += 1;
        onProgress?.({ done, total: chapterPairs.length });
        if (!verses.length) {
          failed.push(`${dataService.bookName(pair.bookId)} ${pair.chapter || "Intro"}`);
        }
        return verses;
      })
    );

    chapterPairs.forEach((pair, index) => {
      const { candidates: generated, pool } = fillInBlankCandidates({
        pair,
        verses: chapterVerses[index],
        bookName: dataService.bookName(pair.bookId),
        selectedVerseSets,
        difficultySet,
        config,
        seed,
      });
      const selectable = generated.filter((question) => difficultyMatch(question, difficultySet));
      candidates.push(...selectable);
      versePool.push(...pool);
    });

    if (failed.length) {
      unmet.push(
        `Couldn't download verses for ${failed.join(", ")}, so no fill-in-the-blank questions were made from them.`
      );
    }
  }

  // Generated questions count once per verse, not once per difficulty
  const writtenStats = buildCandidateStats(candidates.filter((question) => !question.generated));
  const stats = {
    questionCount: writtenStats.questionCount + versePool.length,
    bookCount: new Set([
      ...candidates.filter((question) => !question.generated).map((question) => question.bookId),
      ...versePool.map((verse) => verse.id.split(":")[0]),
    ]).size,
  };

  if (candidates.length === 0) {
    return {
      questions: [],
      unmet: [...unmet, "No questions match the current filters. Try widening type, difficulty, or review filters."],
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

  // Choose `count` questions from `pool`, honouring the difficulty percentages
  const pickWithDifficulty = (pool, count, perVerseCounts) => {
    if (!difficultyShares) {
      return pick(pool, count, perVerseCounts);
    }

    let chosen = [];
    for (const [difficulty, target] of difficultyTargets(difficultyShares, count)) {
      chosen.push(...pick(pool.filter((question) => question.difficulty === difficulty), target, perVerseCounts));
    }

    // Top up from any selected difficulty when a share runs out of questions
    if (chosen.length < count) {
      const taken = new Set(chosen);
      const extra = pick(pool.filter((question) => !taken.has(question)), count - chosen.length, perVerseCounts);
      if (extra.length) {
        unmet.push("Not enough questions to match the difficulty percentages exactly; other difficulties filled in.");
      }
      chosen.push(...extra);
    }
    return chosen;
  };

  const typeShares =
    resolveTypeWeights(typeSet, settings) || naturalTypeShares(randomized, versePool.length);
  const perVerseCounts = new Map();
  let selected;
  if (typeShares) {
    selected = [];
    for (const [group, target] of difficultyTargets(typeShares, settings.totalCount)) {
      const pool = randomized.filter((question) => questionTypeGroupId(question.type) === group);
      selected.push(...pickWithDifficulty(pool, target, perVerseCounts));
    }

    if (selected.length < settings.totalCount) {
      const taken = new Set(selected);
      const extra = pickWithDifficulty(
        randomized.filter((question) => !taken.has(question)),
        settings.totalCount - selected.length,
        perVerseCounts
      );
      if (extra.length) {
        unmet.push("Not enough questions to match the question type percentages exactly; other types filled in.");
      }
      selected.push(...extra);
    }
  } else {
    selected = pickWithDifficulty(randomized, settings.totalCount, perVerseCounts);
  }

  if (difficultyShares || typeShares) {
    selected = shuffle(selected, seed);
  }

  if (selected.length < settings.totalCount) {
    unmet.push(
      `Requested ${settings.totalCount} questions, but only ${selected.length} satisfy all constraints.`
    );
  }

  if (!year) {
    unmet.push("Year mapping not found. Default scope used.");
  }

  const fibContext = versePool.length ? buildTfidfContext(versePool) : { verseLevel: {}, chapterLevel: {} };

  // Tagging verses needs the NLP library, but verses analysed on an earlier visit do not
  if (selected.some((question) => question.generated && question.type === FIB_TYPE && !hasAnalysis(question.verseText))) {
    await loadVendor("compromise").catch(() => {});
  }

  return {
    questions: finalizeFillInBlank(selected, fibContext, seed),
    unmet,
    stats,
    fibContext,
    verseTexts: versePool.map((verse) => verse.text),
  };
}
