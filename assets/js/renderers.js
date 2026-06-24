import { formatInteractivePrompt } from "./question-formatters.js";
import { csvJoin, nowLabel } from "./utils.js";

function formatRef(question) {
  return `${question.book} ${question.chapter}:${question.startVerse}-${question.endVerse}`;
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
  for (const year of years) {
    const option = document.createElement("option");
    option.value = year.id;
    option.textContent = year.name;
    select.append(option);
  }
}

export function renderScopeSelector(container, manifest, selectedScope, options = {}) {
  const chapterAvailability = options.chapterAvailability || null;
  const hideUnavailable = Boolean(options.hideUnavailable);

  container.innerHTML = "";
  let renderedBookCount = 0;

  for (const book of manifest.books) {
    const visibleChapters = book.chapters.filter((chapter) => {
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
    bookWrap.className = "scope-book";

    const bookLabel = document.createElement("label");
    const bookToggle = document.createElement("input");
    bookToggle.type = "checkbox";
    bookToggle.dataset.bookId = book.id;
    bookToggle.dataset.role = "book-toggle";

    const selectedChapters = selectedScope[book.id] || [];
    const selectedVisibleCount = visibleChapters.filter((chapter) =>
      selectedChapters.includes(chapter.number)
    ).length;
    bookToggle.checked = visibleChapters.length > 0 && selectedVisibleCount === visibleChapters.length;
    bookToggle.disabled = visibleChapters.length === 0;
    bookLabel.append(bookToggle, document.createTextNode(` ${book.name}`));

    const chapterWrap = document.createElement("div");
    chapterWrap.className = "scope-chapters";

    for (const chapter of visibleChapters) {
      const chapterLabel = document.createElement("label");
      const chapterToggle = document.createElement("input");
      chapterToggle.type = "checkbox";
      chapterToggle.dataset.bookId = book.id;
      chapterToggle.dataset.chapter = String(chapter.number);
      chapterToggle.dataset.role = "chapter-toggle";
      chapterToggle.checked = selectedChapters.includes(chapter.number);
      chapterLabel.append(chapterToggle, document.createTextNode(` Ch ${chapter.number}`));
      chapterWrap.append(chapterLabel);
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
    node.querySelector("h3").textContent = `${question.type.toUpperCase()} | ${question.points} pt`;
    node.querySelector(".meta").textContent = `${formatRef(question)} | ${question.validatedBy}`;
    node.querySelector(".question").textContent = question.question;
    node.querySelector(".answer").textContent = question.answer;
    previewList.append(node);
  }
}

export function renderPreviewMeta(container, questions, settings, unmetMessages) {
  const lines = [
    `Selected: ${questions.length} questions`,
    `Types: ${csvJoin(settings.selectedTypes)}`,
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
