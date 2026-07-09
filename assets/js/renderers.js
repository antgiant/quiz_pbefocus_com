import { formatInteractivePrompt } from "./question-formatters.js";
import { csvJoin, formatNumberRanges, nowLabel } from "./utils.js";

function formatRef(question) {
  return `${question.book} ${question.chapter}:${question.startVerse}-${question.endVerse}`;
}

function formatDifficulty(question) {
  const difficulty = question.difficulty || "unknown";
  return difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
}

export function renderTypeCheckboxes(container, types, selectedTypes) {
  container.innerHTML = "";
  for (const type of types) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = type;
    checkbox.checked = selectedTypes.includes(type);
    label.append(checkbox, document.createTextNode(type));
    container.append(label);
  }
}

export function renderDifficultyCheckboxes(container, difficulties, selectedDifficulties) {
  container.innerHTML = "";
  for (const difficulty of difficulties) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = difficulty;
    checkbox.checked = selectedDifficulties.includes(difficulty);
    label.append(checkbox, document.createTextNode(formatDifficulty({ difficulty })));
    container.append(label);
  }
}

export function renderProfiles(select, profiles, activeProfileId) {
  select.innerHTML = "";
  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    option.selected = profile.id === activeProfileId;
    select.append(option);
  }
}

export function renderPeopleSelector(container, profiles, selectedIds) {
  container.innerHTML = "";
  for (const profile of profiles) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = profile.id;
    checkbox.checked = selectedIds.includes(profile.id);
    label.append(checkbox, document.createTextNode(profile.name));
    container.append(label);
  }
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
  const limitToSelectedScope = Boolean(options.limitToSelectedScope);
  const selectedVerses = options.selectedVerses || {};
  const selectorMode = options.selectorMode === "verse" ? "verse" : "chapter";

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
    if (limitToSelectedScope && selectedChapters.length === 0) {
      continue;
    }

    const chapterPool = limitToSelectedScope
      ? book.chapters.filter((chapter) => selectedChapters.includes(chapter.number))
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
    chapterWrap.className = selectorMode === "chapter" ? "scope-chapters chapter-grid" : "scope-chapters";

    for (const chapter of visibleChapters) {
      const chapterLabel = document.createElement("label");
      chapterLabel.className = selectorMode === "chapter" ? "chapter-check chapter-option" : "chapter-check chapter-header";
      const chapterToggle = document.createElement("input");
      chapterToggle.type = "checkbox";
      chapterToggle.dataset.bookId = book.id;
      chapterToggle.dataset.chapter = String(chapter.number);
      chapterToggle.dataset.role = "chapter-toggle";
      chapterToggle.checked = selectedChapters.includes(chapter.number);
      const chapterNumber = document.createElement("span");
      chapterNumber.className = "chapter-number";
      chapterNumber.textContent = `Chapter ${chapter.number}`;
      chapterLabel.append(chapterToggle, chapterNumber);

      if (selectorMode === "chapter") {
        chapterWrap.append(chapterLabel);
        continue;
      }

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
      chapterHeaderRow.append(chapterLabel, verseToggleWrap);
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
      `${question.type.toUpperCase()} | ${formatDifficulty(question)} | ${question.points} pt`;
    node.querySelector(".meta").textContent = `${formatRef(question)} | ${question.validatedBy}`;
    node.querySelector(".question").textContent = question.question;
    node.querySelector(".answer").textContent = question.answer;
    previewList.append(node);
  }
}

export function renderPreviewMeta(container, questions, settings, unmetMessages) {
  const difficultyLabels = (settings.selectedDifficulties || []).map((difficulty) =>
    formatDifficulty({ difficulty })
  );
  const lines = [
    `Selected: ${questions.length} questions`,
    `Types: ${csvJoin(settings.selectedTypes)}`,
    `Difficulties: ${csvJoin(difficultyLabels)}`,
    `Generated: ${nowLabel()}`,
  ];

  if (unmetMessages.length) {
    lines.push(`Notes: ${unmetMessages.join(" | ")}`);
  }

  container.textContent = lines.join("  •  ");
}

export function renderInteractive(container, state) {
  container.innerHTML = "";

  if (!state.questions.length) {
    container.textContent = "Generate questions first, then start interactive mode.";
    return;
  }

  if (state.complete) {
    const summary = document.createElement("div");
    summary.className = "interactive-wrap";
    summary.innerHTML = `
      <p class="interactive-progress">Completed ${state.questions.length} questions.</p>
      <h3>Score: ${state.correctCount} / ${state.questions.length}</h3>
      <p>Use Start Interactive Quiz to run again.</p>
    `;
    container.append(summary);
    return;
  }

  const current = state.questions[state.index];
  const prompt = formatInteractivePrompt(current);
  const wrap = document.createElement("div");
  wrap.className = "interactive-wrap";
  const promptHtml = prompt.prompt.replace(/\n/g, "<br>");

  wrap.innerHTML = `
    <p class="interactive-progress">Question ${state.index + 1} of ${state.questions.length}</p>
    <p>${promptHtml}</p>
    <label>
      Your answer
      <input type="text" id="interactiveAnswerInput" autocomplete="off" />
    </label>
    <div class="interactive-actions">
      <button type="button" id="interactiveSubmitBtn">Submit</button>
      <button type="button" id="interactiveRevealBtn">Reveal Answer</button>
      <button type="button" id="interactiveSkipBtn">Skip</button>
    </div>
    <p id="interactiveFeedback"></p>
  `;

  container.append(wrap);
}

export function createPrintSheets(template, questions, selectedPeople, settingsLabel, scopeLabel) {
  const fragment = document.createDocumentFragment();

  selectedPeople.forEach((person, personIndex) => {
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

    questions.forEach((question, index) => {
      const q = document.createElement("li");
      q.textContent = question.question;
      questionList.append(q);

      const a = document.createElement("li");
      a.textContent = question.answer;
      answerList.append(a);
    });

    if (personIndex === selectedPeople.length - 1) {
      answerSheet.classList.add("print-sheet-final");
    }

    fragment.append(root);
  });

  return fragment;
}
