import { QUESTION_TYPE_GROUPS } from "./constants.js";
import {
  formatFillInBlankLead,
  formatInteractiveAnswer,
  formatInteractivePrompt,
  secondsForQuestion,
  verseRuns,
} from "./question-formatters.js";
import { normalizeText } from "./utils.js";
import { csvJoin, formatNumberRanges, nowLabel } from "./utils.js";

function formatRef(question) {
  if (question.refLabel) {
    return question.refLabel;
  }
  return `${question.book} ${question.chapter}:${question.startVerse}-${question.endVerse}`;
}

function formatDifficulty(question) {
  const difficulty = question.difficulty || "unknown";
  return difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
}

function formatQuestionType(type) {
  const group = QUESTION_TYPE_GROUPS.find((candidate) => candidate.id === type);
  if (group) {
    return group.label;
  }

  const normalizedType = String(type || "").trim().toLowerCase();
  if (normalizedType === "true_false") {
    return "True/False";
  }

  return normalizedType
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatQuestionSource(source) {
  if (source === "ai_unreviewed") {
    return "AI Generated (Unreviewed)";
  }

  if (source === "ai_human_reviewed") {
    return "AI Generated (Human reviewed)";
  }

  if (source === "human_generated") {
    return "Human Generated";
  }

  return String(source || "");
}

export function renderTypeCheckboxes(container, types, selectedTypes, weights = {}) {
  container.innerHTML = "";
  for (const type of types) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = type;
    checkbox.checked = selectedTypes.includes(type);
    label.append(checkbox, document.createTextNode(formatQuestionType(type)));

    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "100";
    input.step = "any";
    input.placeholder = "auto";
    input.inputMode = "decimal";
    input.className = "difficulty-weight";
    input.dataset.role = "type-weight";
    input.dataset.type = type;
    input.disabled = !checkbox.checked;
    input.title = "Share of questions of this type. Leave blank to split the remainder evenly.";
    input.setAttribute("aria-label", `${formatQuestionType(type)} percent of questions`);
    if (Number.isFinite(weights[type])) {
      input.value = String(weights[type]);
    }
    label.append(input, document.createTextNode("%"));
    container.append(label);
  }
}

export function renderDifficultyCheckboxes(container, difficulties, selectedDifficulties, weights = {}) {
  container.innerHTML = "";

  for (const difficulty of difficulties) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = difficulty;
    checkbox.checked = selectedDifficulties.includes(difficulty);
    label.append(checkbox, document.createTextNode(formatDifficulty({ difficulty })));

    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "100";
    input.step = "any";
    input.placeholder = "auto";
    input.inputMode = "decimal";
    input.className = "difficulty-weight";
    input.dataset.role = "difficulty-weight";
    input.dataset.difficulty = difficulty;
    input.disabled = !checkbox.checked;
    input.title = "Share of questions at this difficulty. Leave blank to split the remainder evenly.";
    input.setAttribute("aria-label", `${formatDifficulty({ difficulty })} percent of questions`);
    if (Number.isFinite(weights[difficulty])) {
      input.value = String(weights[difficulty]);
    }
    label.append(input, document.createTextNode("%"));

    container.append(label);
  }
}

export function renderSourceCheckboxes(container, sources, selectedSources) {
  container.innerHTML = "";
  for (const source of sources) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = source;
    checkbox.checked = selectedSources.includes(source);
    label.append(checkbox, document.createTextNode(formatQuestionSource(source)));
    container.append(label);
  }
}

// One row per person: drag handle, the person to build for, whether they are
// in the printout, and move buttons (for keyboards and touch screens)
export function renderPeopleList(container, profiles, activeProfileId, printIds) {
  container.innerHTML = "";
  profiles.forEach((profile, index) => {
    const row = document.createElement("li");
    row.className = "person-row";
    row.dataset.id = profile.id;
    row.draggable = true;
    row.classList.toggle("is-active", profile.id === activeProfileId);

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.setAttribute("aria-hidden", "true");
    handle.textContent = "\u283F";

    const pick = document.createElement("label");
    pick.className = "person-pick";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "activePerson";
    radio.value = profile.id;
    radio.checked = profile.id === activeProfileId;
    const name = document.createElement("span");
    name.className = "person-name";
    name.textContent = profile.name;
    pick.append(radio, name);

    const print = document.createElement("label");
    print.className = "person-print";
    const printBox = document.createElement("input");
    printBox.type = "checkbox";
    printBox.value = profile.id;
    printBox.dataset.role = "person-print";
    printBox.checked = printIds.includes(profile.id);
    printBox.setAttribute("aria-label", `Include ${profile.name} in the printed quiz`);
    print.append(printBox, document.createTextNode("Print"));

    const up = document.createElement("button");
    up.type = "button";
    up.className = "person-move";
    up.dataset.role = "move-up";
    up.textContent = "\u25B2";
    up.disabled = index === 0;
    up.setAttribute("aria-label", `Move ${profile.name} up`);

    const down = document.createElement("button");
    down.type = "button";
    down.className = "person-move";
    down.dataset.role = "move-down";
    down.textContent = "\u25BC";
    down.disabled = index === profiles.length - 1;
    down.setAttribute("aria-label", `Move ${profile.name} down`);

    row.append(handle, pick, print, up, down);
    container.append(row);
  });
}

export function renderYearOptions(select, years) {
  select.innerHTML = "";
  const now = new Date();
  const currentSeason = `${now.getFullYear()}-${now.getFullYear() + 1}`;

  for (const year of years) {
    const option = document.createElement("option");
    option.value = year.id;
    const label = String(year.name || year.id);
    option.textContent = label === currentSeason ? `★ ${label}` : label;
    select.append(option);
  }
}

export function renderYearOptionsWithScope(select, years, manifest) {
  select.innerHTML = "";
  const now = new Date();
  const currentSeason = `${now.getFullYear()}-${now.getFullYear() + 1}`;

  const bookNameById = new Map((manifest?.books || []).map((book) => [book.id, book.name]));
  const chapterNumbersByBookId = new Map(
    (manifest?.books || []).map((book) => [
      book.id,
      (book.chapters || [])
        .map((chapter) => Number(chapter.number))
        .filter((chapter) => Number.isInteger(chapter))
        .sort((a, b) => a - b),
    ])
  );

  function isWholeBookSelection(bookId, selectedChapters) {
    const allChapters = chapterNumbersByBookId.get(bookId) || [];
    if (!allChapters.length) {
      return false;
    }

    const selected = Array.from(
      new Set(
        (selectedChapters || [])
          .map((chapter) => Number(chapter))
          .filter((chapter) => Number.isInteger(chapter))
      )
    ).sort((a, b) => a - b);

    if (selected.length !== allChapters.length) {
      return false;
    }

    return allChapters.every((chapter, index) => chapter === selected[index]);
  }

  function parseNumberedBookName(bookName) {
    const match = String(bookName || "").match(/^(\d+)\s+(.+)$/);
    if (!match) {
      return null;
    }

    return {
      number: Number(match[1]),
      base: match[2],
    };
  }

  function formatCombinedNumbers(numbers) {
    const sorted = Array.from(new Set(numbers)).sort((a, b) => a - b);
    if (sorted.length === 0) {
      return "";
    }

    if (sorted.length === 1) {
      return String(sorted[0]);
    }

    if (sorted.length === 2) {
      return `${sorted[0]} & ${sorted[1]}`;
    }

    const contiguous = sorted.every((value, index) => index === 0 || value === sorted[index - 1] + 1);
    if (contiguous) {
      return `${sorted[0]}-${sorted[sorted.length - 1]}`;
    }

    return sorted.join(", ");
  }

  function describeScope(scope) {
    const parts = [];
    const numberedGroups = new Map();

    for (const [bookId, chapters] of Object.entries(scope || {})) {
      if (!Array.isArray(chapters) || chapters.length === 0) {
        continue;
      }

      const normalized = Array.from(
        new Set(chapters.map((chapter) => Number(chapter)).filter((chapter) => Number.isInteger(chapter)))
      ).sort((a, b) => a - b);

      if (!normalized.length) {
        continue;
      }

      const bookName = bookNameById.get(bookId) || bookId;
      const wholeBook = isWholeBookSelection(bookId, normalized);
      const numbered = parseNumberedBookName(bookName);

      if (wholeBook && numbered) {
        const groupKey = numbered.base.toLowerCase();
        if (!numberedGroups.has(groupKey)) {
          numberedGroups.set(groupKey, {
            base: numbered.base,
            entries: [],
          });
        }

        numberedGroups.get(groupKey).entries.push({
          number: numbered.number,
          label: bookName,
        });
        continue;
      }

      const label = wholeBook ? bookName : `${bookName} ${formatNumberRanges(normalized)}`;
      parts.push(label);
    }

    for (const group of numberedGroups.values()) {
      const numbers = group.entries.map((entry) => entry.number).filter((number) => Number.isInteger(number));

      if (numbers.length >= 2) {
        parts.push(`${formatCombinedNumbers(numbers)} ${group.base}`);
        continue;
      }

      if (group.entries.length === 1) {
        parts.push(group.entries[0].label);
      }
    }

    if (!parts.length) {
      return "No chapters mapped yet";
    }

    return parts.join("; ");
  }

  for (const year of years) {
    const option = document.createElement("option");
    option.value = year.id;
    const label = String(year.name || year.id);
    const description = describeScope(year.scope);
    const base = label === currentSeason ? `★ ${label}` : label;
    option.textContent = `${base} - ${description}`;
    select.append(option);
  }
}

export function renderScopeSelector(container, manifest, selectedScope, options = {}) {
  const chapterAvailability = options.chapterAvailability || null;
  const hideUnavailable = Boolean(options.hideUnavailable);
  const scopeLimit =
    options.scopeLimit && typeof options.scopeLimit === "object" ? options.scopeLimit : null;
  const selectedVerses = options.selectedVerses || {};
  const chapterWeights = options.chapterWeights || {};

  function chapterKey(bookId, chapterNumber) {
    return `${bookId}:${chapterNumber}`;
  }

  function normalizeVerseSelection(bookId, chapterNumber, totalVerses) {
    const customVerses = selectedVerses[chapterKey(bookId, chapterNumber)];
    if (!Array.isArray(customVerses)) {
      return null;
    }

    const normalized = Array.from(
      new Set(
        customVerses
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value >= 1 && value <= totalVerses)
      )
    ).sort((a, b) => a - b);

    return normalized;
  }

  function verseSummaryForSelection(selection, totalVerses) {
    if (totalVerses <= 0) {
      return "No verse metadata";
    }

    if (selection === null || selection.length === totalVerses) {
      return "Verses";
    }

    if (selection.length === 0) {
      return "No verses";
    }

    return `v${formatNumberRanges(selection)}`;
  }

  container.innerHTML = "";
  container.classList.add("selectors");
  let renderedBookCount = 0;

  for (const book of manifest.books) {
    const selectedChapters = selectedScope[book.id] || [];
    const scopedChapterNumbers = Array.isArray(scopeLimit?.[book.id])
      ? scopeLimit[book.id]
      : null;

    if (scopeLimit && (!scopedChapterNumbers || scopedChapterNumbers.length === 0)) {
      continue;
    }

    const chapterPool = scopeLimit
      ? book.chapters.filter((chapter) => scopedChapterNumbers.includes(chapter.number))
      : book.chapters;

    const visibleChapters = book.chapters.filter((chapter) => {
      if (!chapterPool.includes(chapter)) {
        return false;
      }

      if (!hideUnavailable || !chapterAvailability) {
        return true;
      }

      const chapterKey = `${book.id}:${chapter.number}`;
      return chapterAvailability.get(chapterKey) !== false;
    });

    if (hideUnavailable && visibleChapters.length === 0) {
      continue;
    }

    renderedBookCount += 1;

    const bookWrap = document.createElement("div");
    bookWrap.className = "book-group scope-book";

    const bookLabel = document.createElement("label");
    bookLabel.className = "book-header";
    const bookToggle = document.createElement("input");
    bookToggle.type = "checkbox";
    bookToggle.dataset.bookId = book.id;
    bookToggle.dataset.role = "book-toggle";

    const selectedVisibleCount = visibleChapters.filter((chapter) =>
      selectedChapters.includes(chapter.number)
    ).length;
    bookToggle.checked = visibleChapters.length > 0 && selectedVisibleCount === visibleChapters.length;
    bookToggle.disabled = visibleChapters.length === 0;
    const bookName = document.createElement("span");
    bookName.className = "book-name";
    bookName.textContent = book.name;
    bookLabel.append(bookToggle, bookName);

    const chapterWrap = document.createElement("div");
    chapterWrap.className = "scope-chapters";

    for (const chapter of visibleChapters) {
      const chapterLabel = document.createElement("label");
      chapterLabel.className = "chapter-check chapter-header";
      const chapterToggle = document.createElement("input");
      chapterToggle.type = "checkbox";
      chapterToggle.dataset.bookId = book.id;
      chapterToggle.dataset.chapter = String(chapter.number);
      chapterToggle.dataset.role = "chapter-toggle";
      chapterToggle.checked = selectedChapters.includes(chapter.number);
      const chapterNumber = document.createElement("span");
      chapterNumber.className = "chapter-number";
      chapterNumber.textContent = chapter.number === 0 ? "Intro" : `Chapter ${chapter.number}`;
      chapterLabel.append(chapterToggle, chapterNumber);

      const weightLabel = document.createElement("label");
      weightLabel.className = "chapter-weight";
      weightLabel.title = "Share of questions from this chapter. Leave blank to split the remainder evenly.";
      const weightInput = document.createElement("input");
      weightInput.type = "number";
      weightInput.min = "0";
      weightInput.max = "100";
      weightInput.step = "any";
      weightInput.placeholder = "auto";
      weightInput.inputMode = "decimal";
      weightInput.dataset.role = "chapter-weight";
      weightInput.dataset.bookId = book.id;
      weightInput.dataset.chapter = String(chapter.number);
      weightInput.setAttribute(
        "aria-label",
        `${book.name} ${chapter.number === 0 ? "intro" : `chapter ${chapter.number}`} percent of questions`
      );
      weightInput.disabled = !chapterToggle.checked;
      const savedWeight = chapterWeights[chapterKey(book.id, chapter.number)];
      if (Number.isFinite(savedWeight)) {
        weightInput.value = String(savedWeight);
      }
      weightLabel.append(weightInput, document.createTextNode("%"));

      const chapterRow = document.createElement("div");
      chapterRow.className = "chapter-with-verses scope-chapter-row";

      const chapterHeaderRow = document.createElement("div");
      chapterHeaderRow.className = "chapter-selector-row";

      const verseToggleWrap = document.createElement("details");
      verseToggleWrap.className = "scope-verse-details";
      verseToggleWrap.dataset.bookId = book.id;
      verseToggleWrap.dataset.chapter = String(chapter.number);
      if (!chapterToggle.checked) {
        verseToggleWrap.classList.add("is-disabled");
      }

      const totalVerses = Number(chapter.verses) || 0;
      const verseSelection = normalizeVerseSelection(book.id, chapter.number, totalVerses);
      const verseSummaryText = verseSummaryForSelection(verseSelection, totalVerses);

      const verseSummary = document.createElement("summary");
      verseSummary.dataset.role = "verse-summary";
      verseSummary.textContent = verseSummaryText === "Verses" ? "Verses" : `Verses: ${verseSummaryText}`;
      verseSummary.title = "Show or hide this chapter's verses";
      verseToggleWrap.append(verseSummary);

      const versesGrid = document.createElement("div");
      versesGrid.className = "chapter-grid verse-grid scope-verses-grid";

      if (totalVerses > 0) {
        const verseActions = document.createElement("div");
        verseActions.className = "scope-verse-actions";

        const allBtn = document.createElement("button");
        allBtn.type = "button";
        allBtn.dataset.role = "verse-select-all";
        allBtn.dataset.bookId = book.id;
        allBtn.dataset.chapter = String(chapter.number);
        allBtn.textContent = "All";
        allBtn.disabled = !chapterToggle.checked;

        const clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.dataset.role = "verse-clear-all";
        clearBtn.dataset.bookId = book.id;
        clearBtn.dataset.chapter = String(chapter.number);
        clearBtn.textContent = "Clear";
        clearBtn.disabled = !chapterToggle.checked;

        const rangeWrap = document.createElement("label");
        rangeWrap.className = "scope-verse-range";
        rangeWrap.textContent = "Range";

        const rangeStart = document.createElement("input");
        rangeStart.type = "number";
        rangeStart.min = "1";
        rangeStart.max = String(totalVerses);
        rangeStart.placeholder = "1";
        rangeStart.dataset.role = "verse-range-start";
        rangeStart.dataset.bookId = book.id;
        rangeStart.dataset.chapter = String(chapter.number);
        rangeStart.disabled = !chapterToggle.checked;

        const rangeEnd = document.createElement("input");
        rangeEnd.type = "number";
        rangeEnd.min = "1";
        rangeEnd.max = String(totalVerses);
        rangeEnd.placeholder = String(totalVerses);
        rangeEnd.dataset.role = "verse-range-end";
        rangeEnd.dataset.bookId = book.id;
        rangeEnd.dataset.chapter = String(chapter.number);
        rangeEnd.disabled = !chapterToggle.checked;

        const rangeBtn = document.createElement("button");
        rangeBtn.type = "button";
        rangeBtn.dataset.role = "verse-apply-range";
        rangeBtn.dataset.bookId = book.id;
        rangeBtn.dataset.chapter = String(chapter.number);
        rangeBtn.textContent = "Apply";
        rangeBtn.disabled = !chapterToggle.checked;

        rangeWrap.append(rangeStart, rangeEnd);
        verseActions.append(allBtn, clearBtn, rangeWrap, rangeBtn);
        verseToggleWrap.append(verseActions);

        for (let verse = 1; verse <= totalVerses; verse += 1) {
          const verseLabel = document.createElement("label");
          verseLabel.className = "chapter-check verse-check";
          const verseToggle = document.createElement("input");
          verseToggle.type = "checkbox";
          verseToggle.dataset.role = "verse-toggle";
          verseToggle.dataset.bookId = book.id;
          verseToggle.dataset.chapter = String(chapter.number);
          verseToggle.dataset.verse = String(verse);
          verseToggle.dataset.totalVerses = String(totalVerses);
          verseToggle.disabled = !chapterToggle.checked;
          verseToggle.checked = verseSelection ? verseSelection.includes(verse) : true;
          const verseNumber = document.createElement("span");
          verseNumber.className = "chapter-number";
          verseNumber.textContent = String(verse);
          verseLabel.append(verseToggle, verseNumber);
          versesGrid.append(verseLabel);
        }
      } else {
        const empty = document.createElement("p");
        empty.className = "scope-empty verse-placeholder";
        empty.textContent = "No verse metadata";
        versesGrid.append(empty);
      }

      verseToggleWrap.append(versesGrid);
      chapterHeaderRow.append(chapterLabel, weightLabel, verseToggleWrap);
      chapterRow.append(chapterHeaderRow);
      chapterWrap.append(chapterRow);
    }

    bookWrap.append(bookLabel, chapterWrap);
    container.append(bookWrap);
  }

  if (renderedBookCount === 0) {
    const empty = document.createElement("p");
    empty.className = "scope-empty";
    empty.textContent = "No chapters available for current filters.";
    container.append(empty);
  }
}

export function renderPreview(previewList, template, questions) {
  previewList.innerHTML = "";

  for (const question of questions) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector("h3").textContent =
      `${formatQuestionType(question.type)} | ${formatDifficulty(question)} | ${question.points} pt`;
    node.querySelector(".meta").textContent = `${formatRef(question)} | ${
      question.generated ? "Generated from verse text" : question.validatedBy
    }`;
    node.querySelector(".question").textContent = question.question;
    node.querySelector(".answer").textContent = question.answer;
    previewList.append(node);
  }
}

export function renderPreviewMeta(container, questions, settings, unmetMessages) {
  const difficultyLabels = (settings.selectedDifficulties || []).map((difficulty) =>
    formatDifficulty({ difficulty })
  );
  const typeLabels = (settings.selectedTypes || []).map((type) => formatQuestionType(type));
  const sourceLabels = (settings.selectedSources || []).map((source) => formatQuestionSource(source));
  const lines = [
    `Selected: ${questions.length} questions`,
    `Sources: ${csvJoin(sourceLabels)}`,
    `Types: ${csvJoin(typeLabels)}`,
    `Difficulties: ${csvJoin(difficultyLabels)}`,
    `Generated: ${nowLabel()}`,
  ];

  if (unmetMessages.length) {
    lines.push(`Notes: ${unmetMessages.join(" | ")}`);
  }

  container.textContent = lines.join("  •  ");
}

export function interactivePossiblePoints(question) {
  return Math.max(1, Number(question.points) || 1);
}

export function interactiveTotals(state) {
  let earned = 0;
  let possible = 0;
  state.questions.forEach((question, i) => {
    possible += interactivePossiblePoints(question);
    earned += state.results[i]?.awarded || 0;
  });
  return { earned, possible };
}

// Percent of the points available on answered questions that were earned
export function interactivePercent(state) {
  let earned = 0;
  let possible = 0;
  state.questions.forEach((question, i) => {
    if (state.results[i]?.status !== "unanswered") {
      possible += interactivePossiblePoints(question);
      earned += state.results[i].awarded || 0;
    }
  });
  return possible ? `${Math.round((earned / possible) * 100)}%` : "–";
}

export function interactiveProgressText(state) {
  const { earned, possible } = interactiveTotals(state);
  return `Question ${state.index + 1} of ${state.questions.length} · ${earned} / ${possible} points so far · ${interactivePercent(state)}`;
}

export function interactiveTimerText(result) {
  if (result.expired) {
    return "Time's up";
  }
  const total = Math.ceil((result.remainingMs ?? 0) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// Full verse text, with the words that answer the question highlighted. Given what the player
// answered, words they got are green and the ones they missed stay red.
export function renderVerseText(target, verses, answer, typed = null, allMatched = false) {
  target.textContent = "";
  if (!verses.length) {
    target.textContent = "Verse text unavailable.";
    return;
  }
  for (const run of verseRuns(verses, answer, typed, allMatched)) {
    if (run.isAnswer) {
      const mark = document.createElement("span");
      mark.className = run.matched ? "answer-words is-matched" : "answer-words";
      mark.textContent = run.text;
      if (typed !== null) {
        mark.title = run.matched ? "In your answer" : "Missing from your answer";
      }
      target.append(mark);
    } else {
      target.append(run.text);
    }
  }
}

// First letter and the length, e.g. "T _ _ _ _". Counts as a hint, so the blank doesn't score.
export function blankHint(word) {
  const letters = Array.from(String(word || ""));
  return letters.length ? [letters[0], ...letters.slice(1).map(() => "_")].join(" ") : "";
}

// The verse with each blank shown as an underscore to tap. Tapping opens a text box. Every blank in a question is the same width so the
// length of a word is never a clue.
function renderBlankedVerse(target, question, result) {
  target.textContent = "";
  const longestAnswer = Math.max(...question.blankWords.map((word) => word.length));
  const width = `${Math.max(5, longestAnswer + 2)}ch`;
  const opened = result.opened || [];
  const peeked = result.peeked || [];
  let blankIndex = 0;
  for (const segment of question.segments) {
    if (!segment.blank) {
      target.append(segment.text);
      continue;
    }
    const index = blankIndex;
    blankIndex += 1;
    const label = `Blank ${index + 1} of ${question.blankWords.length}`;

    const hinted = result.hinted.includes(index);
    const graded = result.status !== "unanswered";
    // Realistic mode gives one chance per question: once answered or left, it stays locked
    const locked = graded || Boolean(result.stateRealisticLock);
    const typed = Boolean((result.inputs[index] || "").length);
    if (!(opened.includes(index) || typed || hinted || locked)) {
      const blank = document.createElement("button");
      blank.type = "button";
      blank.className = "fib-blank";
      blank.dataset.index = String(index);
      blank.textContent = "_____";
      blank.setAttribute("aria-label", `${label}, empty. Activate to fill in.`);
      target.append(blank);
      continue;
    }

    const input = document.createElement("input");
    input.type = "text";
    input.className = "fib-input";
    input.dataset.index = String(index);
    input.autocomplete = "off";
    input.autocapitalize = "off";
    input.spellcheck = false;
    input.value = result.inputs[index] || "";
    input.style.width = width;
    input.setAttribute("aria-label", label);

    // A partial hint leaves the box open to type in; a full hint fills it in and locks it
    const peek = peeked.includes(index);
    if (peek) {
      input.placeholder = blankHint(question.blankWords[index]);
    }
    // The whole word was shown by a hint: put it in the box itself, styled apart from typing
    const revealed = hinted && !peek;
    if (revealed) {
      input.value = question.blankWords[index];
      input.title = "Shown by a hint, not typed";
    }
    input.readOnly = revealed || locked;
    input.classList.toggle("is-hinted", hinted);
    input.classList.toggle("is-revealed", revealed);
    if (graded && result.blankCorrect) {
      // A blank filled by a hint counts as incorrect, but isn't marked as a wrong answer
      const mark = hinted ? "hint used, counts as incorrect" : result.blankCorrect[index] ? "correct" : "incorrect";
      if (!hinted) {
        input.classList.add(result.blankCorrect[index] ? "is-correct" : "is-incorrect");
      }
      input.setAttribute("aria-label", `${input.getAttribute("aria-label")}, ${mark}`);
    }
    target.append(input);

    // "?" reveals the word in two taps: first letter and length, then the whole word
    if (!locked && !(hinted && !peek)) {
      const help = document.createElement("button");
      help.type = "button";
      help.className = "fib-help";
      help.dataset.index = String(index);
      help.textContent = "?";
      help.title = hinted ? "Show the whole word (counts as incorrect)" : "Hint: first letter and length (counts as incorrect)";
      help.setAttribute("aria-label", `${label}, ${hinted ? "show the whole word" : "show a hint"}`);
      target.append(help);
    }
  }
}

// Whether each blank was filled in correctly. A blank filled in by a hint is
// right on its face, but it doesn't score: see countedBlanks.
export function gradeBlanks(question, inputs) {
  return question.blankWords.map((word, index) => {
    const typed = normalizeText(inputs[index] || "");
    return Boolean(typed) && typed === normalizeText(word);
  });
}

// The blanks that earn a point by default: correct, and not given away by a hint
export function countedBlanks(blankCorrect, hinted = []) {
  return blankCorrect.map((correct, index) => correct && !hinted.includes(index));
}

export function interactiveHintsUsed(state) {
  return state.results.reduce((sum, result) => sum + (result.hinted?.length || 0), 0);
}

export function renderInteractive(container, state) {
  container.innerHTML = "";

  if (!state.questions.length) {
    container.textContent = "Generate questions first, then start interactive mode.";
    return;
  }

  if (state.complete) {
    const { earned, possible } = interactiveTotals(state);
    const answered = state.results.filter((result) => result.status !== "unanswered").length;
    const hints = interactiveHintsUsed(state);
    const canPracticeAgain = state.questions.some((question) => question.generated);
    const summary = document.createElement("div");
    summary.className = "interactive-wrap";
    summary.innerHTML = `
      <p class="interactive-progress">Completed ${state.questions.length} questions (${answered} answered).</p>
      <h3>Score: ${earned} / ${possible} points (${interactivePercent(state)})</h3>
      ${hints ? `<p class="interactive-hints-note">Hints used: ${hints}</p>` : ""}
      <div class="interactive-actions">
        <button type="button" id="interactivePrevBtn">Previous</button>
        ${
          canPracticeAgain
            ? '<button type="button" id="interactivePracticeAgainBtn" class="primary">Practice again with new blanks</button>'
            : ""
        }
      </div>
      <p>Use Start Interactive Quiz to run again${canPracticeAgain ? ", or practice the same verses with different words blanked" : ""}.</p>
    `;
    container.append(summary);
    return;
  }

  const current = state.questions[state.index];
  const result = state.results[state.index];
  if (current.segments && !result.inputs) {
    result.inputs = current.blankWords.map(() => "");
    result.hinted = [];
  }
  if (current.segments) {
    result.opened = result.opened || [];
    result.peeked = result.peeked || [];
  }
  const isBlankQuiz = Boolean(current.segments);
  const prompt = formatInteractivePrompt(current);
  const wrap = document.createElement("div");
  wrap.className = "interactive-wrap";
  const promptHtml = prompt.prompt.replace(/\n/g, "<br>");
  const isLast = state.index === state.questions.length - 1;
  const locked = Boolean(state.options?.realistic && (result.expired || result.status !== "unanswered"));

  // One main button: submit the answer, then move on. Once time is up in realistic mode
  // there is nothing left to submit, so it only moves on.
  const answered = result.status !== "unanswered" || locked;
  const actionLabel = answered ? (isLast ? "Finish" : "Next") : "Submit";

  const answerArea = isBlankQuiz
    ? `
    <p class="fib-lead"></p>
    <p id="interactiveFibVerse" class="fib-verse"></p>`
    : `
    <p>${promptHtml}</p>
    <label>
      Your answer
      <input type="text" id="interactiveAnswerInput" autocomplete="off" />
    </label>`;

  wrap.innerHTML = `
    <p class="interactive-progress"></p>
    <p id="interactiveTimer" class="interactive-timer" hidden></p>
    ${answerArea}
    <div class="interactive-actions">
      <button type="button" id="interactivePrevBtn"${state.index === 0 ? " disabled" : ""}>Previous</button>
      <button type="button" id="interactiveSubmitBtn" class="primary"></button>
    </div>
    <div id="interactiveAnswerPanel" class="interactive-answer" hidden></div>
  `;

  wrap.querySelector(".interactive-progress").textContent = interactiveProgressText(state);
  wrap.querySelector("#interactiveSubmitBtn").textContent = actionLabel;

  if (isBlankQuiz) {
    const points = interactivePossiblePoints(current);
    wrap.querySelector(".fib-lead").textContent = `${formatFillInBlankLead(current)} (${points} ${
      points === 1 ? "Pt." : "Pts."
    })`;
    result.stateRealisticLock = locked;
    renderBlankedVerse(wrap.querySelector("#interactiveFibVerse"), current, result);
  } else {
    const input = wrap.querySelector("#interactiveAnswerInput");
    input.value = result.input;
    // Realistic mode gives one chance per question: once answered or left, it stays locked
    input.readOnly = locked;
  }

  const timerNode = wrap.querySelector("#interactiveTimer");
  if (state.options?.timer && result.status === "unanswered") {
    if (result.remainingMs == null) {
      result.remainingMs = secondsForQuestion(current, state.options.timer) * 1000;
    }
    timerNode.hidden = false;
    timerNode.textContent = interactiveTimerText(result);
    timerNode.classList.toggle("urgent", !result.expired && result.remainingMs <= 10000);
  }
  container.append(wrap);

  if (result.status !== "unanswered") {
    renderInteractiveAnswerPanel(wrap.querySelector("#interactiveAnswerPanel"), current, result);
  }
}

function renderBlankedAnswer(target, question) {
  target.textContent = "";
  for (const segment of question.segments) {
    if (segment.blank) {
      const mark = document.createElement("span");
      mark.className = "answer-words";
      mark.textContent = segment.word;
      target.append(mark);
    } else {
      target.append(segment.text);
    }
  }
}

function renderInteractiveAnswerPanel(panel, question, result) {
  const answerBlock = formatInteractiveAnswer(question);
  const max = interactivePossiblePoints(question);
  const isBlankQuiz = Boolean(question.segments);
  panel.hidden = false;
  panel.innerHTML = `
    <p id="interactiveFeedback" class="interactive-feedback"></p>
    <p class="interactive-answer-text"></p>
    ${isBlankQuiz ? '<ol class="fib-results"></ol><p class="interactive-hints-note" hidden></p>' : ""}
    <p class="interactive-reference"></p>
    <p id="interactiveVerseText" class="interactive-verse">${isBlankQuiz ? "" : "Loading verse text&hellip;"}</p>
    <fieldset class="interactive-points">
      <legend>Points awarded (out of ${max})</legend>
    </fieldset>
  `;

  panel.querySelector(".interactive-answer-text").textContent = answerBlock.answer;
  panel.querySelector(".interactive-reference").textContent = answerBlock.reference;

  if (isBlankQuiz) {
    const counted = countedBlanks(result.blankCorrect || [], result.hinted);
    const correctCount = counted.filter(Boolean).length;
    panel.querySelector("#interactiveFeedback").textContent =
      result.status === "submitted"
        ? `${correctCount} of ${question.blankWords.length} blanks correct.`
        : "";

    const list = panel.querySelector(".fib-results");
    question.blankWords.forEach((word, index) => {
      const item = document.createElement("li");
      const hinted = result.hinted.includes(index);
      const typed = (result.inputs[index] || "").trim();
      if (result.status === "submitted") {
        const correct = Boolean(result.blankCorrect?.[index]);
        if (hinted) {
          // Marked with a lightbulb; the "Hints used" note below says what that means
          item.className = "is-hinted";
          item.textContent = word;
        } else {
          item.className = correct ? "is-correct" : "is-incorrect";
          item.textContent = correct ? word : `${typed || "(blank)"} \u2192 ${word}`;
        }
      } else {
        item.textContent = word;
      }
      list.append(item);
    });

    const note = panel.querySelector(".interactive-hints-note");
    if (result.hinted.length) {
      note.hidden = false;
      note.textContent = `Hints used: ${result.hinted.length}. Blanks filled by a hint count as incorrect (change the points below if you disagree).`;
    }
    renderBlankedAnswer(panel.querySelector("#interactiveVerseText"), question);
  } else {
    panel.querySelector("#interactiveFeedback").textContent =
      result.status === "submitted"
        ? result.autoCorrect
          ? "Looks correct."
          : "Compare your answer with the one below."
        : "";
  }

  const points = panel.querySelector(".interactive-points");
  for (let value = 0; value <= max; value += 1) {
    const label = document.createElement("label");
    label.className = "interactive-point-option";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "interactivePoints";
    radio.value = String(value);
    radio.checked = value === result.awarded;
    label.append(radio, ` ${value}`);
    points.append(label);
  }
}

export function createPrintSheets(template, entries) {
  const fragment = document.createDocumentFragment();

  entries.forEach(({ person, questions, settingsLabel, scopeLabel }, personIndex) => {
    const root = template.content.cloneNode(true);
    const questionSheet = root.querySelector(".print-sheet");
    const answerSheet = root.querySelector(".answer-sheet");

    questionSheet.querySelector(".print-meta").textContent =
      `${person.name} | ${settingsLabel}`;
    questionSheet.querySelector(".print-scope").textContent = scopeLabel;
    answerSheet.querySelector(".print-meta").textContent =
      `${person.name} | ${settingsLabel}`;
    answerSheet.querySelector(".print-scope").textContent = scopeLabel;

    const questionList = questionSheet.querySelector(".print-questions");
    const answerList = answerSheet.querySelector(".print-answers");

    questions.forEach((question) => {
      const q = document.createElement("li");
      const a = document.createElement("li");
      if (question.segments) {
        q.append(`${formatFillInBlankLead(question)} `);
        a.append(`${formatFillInBlankLead(question)} `);
        for (const segment of question.segments) {
          if (!segment.blank) {
            q.append(segment.text);
            a.append(segment.text);
            continue;
          }
          const blank = document.createElement("span");
          blank.className = "print-blank";
          q.append(blank);
          const word = document.createElement("strong");
          word.className = "print-answer-word";
          word.textContent = segment.word;
          a.append(word);
        }
      } else {
        q.textContent = question.question;
        a.textContent = question.answer;
      }
      questionList.append(q);
      answerList.append(a);
    });

    if (personIndex === entries.length - 1) {
      answerSheet.classList.add("print-sheet-final");
    }

    fragment.append(root);
  });

  return fragment;
}
