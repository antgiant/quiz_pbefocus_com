import { DEFAULT_SETTINGS, QUESTION_DIFFICULTIES, QUESTION_TYPES } from "./constants.js";
import { DataService } from "./data-service.js";
import { exportPowerPoint } from "./exporters.js";
import { generateQuestions } from "./quiz-engine.js";
import {
  createPrintSheets,
  renderDifficultyCheckboxes,
  renderInteractive,
  renderPeopleSelector,
  renderPreview,
  renderPreviewMeta,
  renderProfiles,
  renderScopeSelector,
  renderTypeCheckboxes,
  renderYearOptionsWithScope,
} from "./renderers.js";
import {
  addProfile,
  deleteActiveProfile,
  getActiveProfile,
  loadState,
  saveState,
} from "./storage.js";
import { formatInteractiveAnswer } from "./question-formatters.js";
import { formatNumberRanges, normalizeText } from "./utils.js";

const dataService = new DataService();
const appState = {
  storage: loadState(),
  years: [],
  manifest: null,
  generatedQuestions: [],
  unmet: [],
  interactive: {
    questions: [],
    index: 0,
    correctCount: 0,
    complete: false,
  },
  generationTimer: null,
};

const el = {
  questionBankStats: document.getElementById("questionBankStats"),
  yearSelect: document.getElementById("yearSelect"),
  totalCountInput: document.getElementById("totalCountInput"),
  perVerseInput: document.getElementById("perVerseInput"),
  difficultyCheckboxes: document.getElementById("difficultyCheckboxes"),
  humanReviewedOnlyInput: document.getElementById("humanReviewedOnlyInput"),
  typeCheckboxes: document.getElementById("typeCheckboxes"),
  scopeSelector: document.getElementById("scopeSelector"),
  newProfileBtn: document.getElementById("newProfileBtn"),
  saveProfileBtn: document.getElementById("saveProfileBtn"),
  deleteProfileBtn: document.getElementById("deleteProfileBtn"),
  activeProfileSelect: document.getElementById("activeProfileSelect"),
  profileNameInput: document.getElementById("profileNameInput"),
  printPeopleSelector: document.getElementById("printPeopleSelector"),
  togglePreviewBtn: document.getElementById("togglePreviewBtn"),
  printBtn: document.getElementById("printBtn"),
  pptBtn: document.getElementById("pptBtn"),
  startInteractiveBtn: document.getElementById("startInteractiveBtn"),
  statusMessage: document.getElementById("statusMessage"),
  printRoot: document.getElementById("printRoot"),
  previewPanel: document.getElementById("previewPanel"),
  previewMeta: document.getElementById("previewMeta"),
  previewList: document.getElementById("previewList"),
  interactivePanel: document.getElementById("interactivePanel"),
  interactiveContainer: document.getElementById("interactiveContainer"),
  questionCardTemplate: document.getElementById("questionCardTemplate"),
  printTemplate: document.getElementById("printTemplate"),
};

function setStatus(message, mode = "") {
  el.statusMessage.textContent = message;
  el.statusMessage.className = mode ? `status ${mode}` : "status";
}

function formatQuestionBankStats(stats) {
  const questionCount = Number(stats?.questionCount) || 0;
  const bookCount = Number(stats?.bookCount) || 0;
  const questionLabel = questionCount === 1 ? "question" : "questions";
  const bookLabel = bookCount === 1 ? "book" : "books";

  return `${questionCount.toLocaleString()} ${questionLabel} across ${bookCount.toLocaleString()} ${bookLabel}`;
}

function renderQuestionBankStats(stats) {
  el.questionBankStats.textContent = formatQuestionBankStats(stats);
}

function normalizeSelectedDifficulties(selectedDifficulties, legacyDifficulty) {
  if (Array.isArray(selectedDifficulties)) {
    return selectedDifficulties.filter((difficulty) => QUESTION_DIFFICULTIES.includes(difficulty));
  }

  if (QUESTION_DIFFICULTIES.includes(legacyDifficulty)) {
    return [legacyDifficulty];
  }

  return [...QUESTION_DIFFICULTIES];
}

function ensureProfileState() {
  const active = getActiveProfile(appState.storage);
  const savedSelectedDifficulties = active.settings?.selectedDifficulties;
  const savedDifficulty = active.settings?.difficulty;
  active.settings = { ...DEFAULT_SETTINGS, ...active.settings };
  active.settings.selectedDifficulties = normalizeSelectedDifficulties(
    savedSelectedDifficulties,
    savedDifficulty
  );
  delete active.settings.difficulty;

  if (!Array.isArray(active.settings.selectedTypes) || !active.settings.selectedTypes.length) {
    active.settings.selectedTypes = [...QUESTION_TYPES];
  }

  if (!active.selectedScope || typeof active.selectedScope !== "object") {
    active.selectedScope = {};
  }

  if (!active.selectedVerses || typeof active.selectedVerses !== "object") {
    active.selectedVerses = {};
  }

  if (!Array.isArray(appState.storage.selectedPrintPeopleIds)) {
    appState.storage.selectedPrintPeopleIds = [active.id];
  }
}

function getActiveYear() {
  const active = getActiveProfile(appState.storage);
  return appState.years.find((year) => year.id === active.settings.yearId) || appState.years[0] || null;
}

function getScopeForActive() {
  const active = getActiveProfile(appState.storage);
  const year = getActiveYear();
  const yearScope = year?.scope || {};

  const hasCustomScope = Object.keys(active.selectedScope || {}).length > 0;
  return hasCustomScope ? active.selectedScope : structuredClone(yearScope);
}

function renderControls() {
  const active = getActiveProfile(appState.storage);
  const settings = active.settings;
  settings.selectedDifficulties = normalizeSelectedDifficulties(settings.selectedDifficulties);

  renderYearOptionsWithScope(el.yearSelect, appState.years, appState.manifest);
  el.yearSelect.value = settings.yearId;
  el.totalCountInput.value = settings.totalCount;
  el.perVerseInput.value = settings.perVerse;
  el.humanReviewedOnlyInput.checked = settings.humanReviewedOnly;

  renderDifficultyCheckboxes(
    el.difficultyCheckboxes,
    QUESTION_DIFFICULTIES,
    settings.selectedDifficulties
  );
  renderTypeCheckboxes(el.typeCheckboxes, QUESTION_TYPES, settings.selectedTypes);
  renderScopeSelector(el.scopeSelector, appState.manifest, getScopeForActive(), {
    limitToSelectedScope: true,
    selectedVerses: active.selectedVerses,
  });
}

function chapterScopeKey(bookId, chapter) {
  return `${bookId}:${chapter}`;
}

function pruneSelectedVersesToScope(selectedVerses, scope) {
  const pruned = {};

  for (const [key, verses] of Object.entries(selectedVerses || {})) {
    const [bookId, chapterText] = key.split(":");
    const chapter = Number(chapterText);
    if (!bookId || !Number.isInteger(chapter)) {
      continue;
    }

    if (!(scope[bookId] || []).includes(chapter)) {
      continue;
    }

    if (!Array.isArray(verses)) {
      continue;
    }

    const normalized = Array.from(
      new Set(verses.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))
    ).sort((a, b) => a - b);

    pruned[key] = normalized;
  }

  return pruned;
}

function questionMatchesAvailabilityFilters(question, settings) {
  const typeSet = new Set(settings.selectedTypes || []);
  const difficultySet = new Set(settings.selectedDifficulties || []);
  if (!typeSet.has(question.type)) {
    return false;
  }

  if (settings.humanReviewedOnly && question.validatedBy !== "human") {
    return false;
  }

  if (!difficultySet.has(question.difficulty)) {
    return false;
  }

  return true;
}

async function buildAvailabilityMap(settings) {
  const availability = new Map();

  for (const book of appState.manifest.books) {
    for (const chapter of book.chapters) {
      let chapterQuestions = [];
      try {
        chapterQuestions = await dataService.loadChapter(book.id, chapter.number);
      } catch {
        chapterQuestions = [];
      }
      const hasAnyMatch = chapterQuestions.some((question) =>
        questionMatchesAvailabilityFilters(question, settings)
      );
      availability.set(`${book.id}:${chapter.number}`, hasAnyMatch);
    }
  }

  return availability;
}

function pruneScopeToAvailability(scope, availability) {
  const pruned = {};

  for (const [bookId, chapters] of Object.entries(scope)) {
    const kept = chapters.filter((chapter) => availability.get(`${bookId}:${chapter}`) !== false);
    if (kept.length > 0) {
      pruned[bookId] = kept;
    }
  }

  return pruned;
}

async function refreshScopeSelectorForFilters() {
  const active = getActiveProfile(appState.storage);
  const scope = getScopeForActive();
  const settings = active.settings;
  settings.selectedDifficulties = normalizeSelectedDifficulties(settings.selectedDifficulties);

  if (
    !settings.selectedTypes ||
    settings.selectedTypes.length === 0 ||
    settings.selectedDifficulties.length === 0
  ) {
    active.selectedScope = {};
    active.selectedVerses = {};
    saveState(appState.storage);
    renderScopeSelector(el.scopeSelector, appState.manifest, {}, {
      chapterAvailability: new Map(),
      hideUnavailable: true,
      limitToSelectedScope: true,
      selectedVerses: {},
    });
    return;
  }

  const shouldFilterAvailability =
    settings.humanReviewedOnly ||
    settings.selectedDifficulties.length < QUESTION_DIFFICULTIES.length ||
    settings.selectedTypes.length < QUESTION_TYPES.length;

  if (!shouldFilterAvailability) {
    renderScopeSelector(el.scopeSelector, appState.manifest, scope, {
      limitToSelectedScope: true,
      selectedVerses: active.selectedVerses,
    });
    return;
  }

  const availability = await buildAvailabilityMap(settings);
  const prunedScope = pruneScopeToAvailability(scope, availability);
  const prunedSelectedVerses = pruneSelectedVersesToScope(active.selectedVerses, prunedScope);

  active.selectedScope = prunedScope;
  active.selectedVerses = prunedSelectedVerses;
  saveState(appState.storage);

  renderScopeSelector(el.scopeSelector, appState.manifest, prunedScope, {
    chapterAvailability: availability,
    hideUnavailable: true,
    limitToSelectedScope: true,
    selectedVerses: prunedSelectedVerses,
  });
}

function renderProfileArea() {
  renderProfiles(el.activeProfileSelect, appState.storage.profiles, appState.storage.activeProfileId);

  const active = getActiveProfile(appState.storage);
  el.profileNameInput.value = active.name;

  renderPeopleSelector(
    el.printPeopleSelector,
    appState.storage.profiles,
    appState.storage.selectedPrintPeopleIds
  );
}

function syncSettingsFromControls() {
  const active = getActiveProfile(appState.storage);
  active.settings.yearId = el.yearSelect.value;
  active.settings.totalCount = Math.max(1, Number(el.totalCountInput.value) || 1);
  active.settings.perVerse = Math.max(1, Number(el.perVerseInput.value) || 1);
  active.settings.humanReviewedOnly = el.humanReviewedOnlyInput.checked;
  active.settings.selectedDifficulties = Array.from(
    el.difficultyCheckboxes.querySelectorAll('input[type="checkbox"]:checked')
  ).map((checkbox) => checkbox.value);
  delete active.settings.difficulty;

  active.settings.selectedTypes = Array.from(
    el.typeCheckboxes.querySelectorAll('input[type="checkbox"]:checked')
  ).map((checkbox) => checkbox.value);

  saveState(appState.storage);
}

function queueRealtimeGenerate() {
  if (appState.generationTimer) {
    clearTimeout(appState.generationTimer);
  }

  appState.generationTimer = window.setTimeout(() => {
    generateAndRender().catch((error) => setStatus(error.message, "warn"));
  }, 180);
}

function refreshScopeThenGenerate() {
  refreshScopeSelectorForFilters()
    .then(() => {
      syncScopeFromControls();
      queueRealtimeGenerate();
    })
    .catch((error) => setStatus(error.message, "warn"));
}

function syncScopeFromControls() {
  const active = getActiveProfile(appState.storage);
  const scope = {};
  const selectedVerses = {};

  el.scopeSelector.querySelectorAll('[data-role="chapter-toggle"]').forEach((toggle) => {
    if (!toggle.checked) {
      return;
    }

    const bookId = toggle.dataset.bookId;
    const chapter = Number(toggle.dataset.chapter);
    if (!scope[bookId]) {
      scope[bookId] = [];
    }
    scope[bookId].push(chapter);

    const verseToggles = Array.from(
      el.scopeSelector.querySelectorAll(
        `input[data-role="verse-toggle"][data-book-id="${bookId}"][data-chapter="${chapter}"]`
      )
    );

    if (!verseToggles.length) {
      return;
    }

    const totalVerses = Number(verseToggles[0].dataset.totalVerses || verseToggles.length);
    const checkedVerses = verseToggles
      .filter((verseToggle) => verseToggle.checked)
      .map((verseToggle) => Number(verseToggle.dataset.verse))
      .filter((verse) => Number.isInteger(verse))
      .sort((a, b) => a - b);

    if (checkedVerses.length !== totalVerses) {
      selectedVerses[chapterScopeKey(bookId, chapter)] = checkedVerses;
    }
  });

  active.selectedScope = scope;
  active.selectedVerses = selectedVerses;
  saveState(appState.storage);
}

function updateChapterVerseSummary(bookId, chapter) {
  const details = el.scopeSelector.querySelector(
    `.scope-verse-details[data-book-id="${bookId}"][data-chapter="${chapter}"]`
  );
  if (!details) {
    return;
  }

  const summaryNode = details.querySelector('summary[data-role="verse-summary"]');
  if (!summaryNode) {
    return;
  }

  const verseToggles = Array.from(
    details.querySelectorAll('input[data-role="verse-toggle"]')
  );

  if (!verseToggles.length) {
    summaryNode.textContent = "Verses: No verse metadata";
    return;
  }

  const totalVerses = Number(verseToggles[0].dataset.totalVerses || verseToggles.length);
  const checkedVerses = verseToggles
    .filter((verseToggle) => verseToggle.checked)
    .map((verseToggle) => Number(verseToggle.dataset.verse))
    .filter((verse) => Number.isInteger(verse));

  if (checkedVerses.length === 0) {
    summaryNode.textContent = "Verses: No verses";
    return;
  }

  if (checkedVerses.length === totalVerses) {
    summaryNode.textContent = "Verses: All verses";
    return;
  }

  summaryNode.textContent = `Verses: v${formatNumberRanges(checkedVerses)}`;
}

function getChapterVerseControls(bookId, chapter) {
  const details = el.scopeSelector.querySelector(
    `.scope-verse-details[data-book-id="${bookId}"][data-chapter="${chapter}"]`
  );
  if (!details) {
    return null;
  }

  const verseToggles = Array.from(details.querySelectorAll('input[data-role="verse-toggle"]'));
  const rangeStart = details.querySelector('input[data-role="verse-range-start"]');
  const rangeEnd = details.querySelector('input[data-role="verse-range-end"]');
  const actionButtons = Array.from(
    details.querySelectorAll('button[data-role="verse-select-all"], button[data-role="verse-clear-all"], button[data-role="verse-apply-range"]')
  );

  return {
    details,
    verseToggles,
    rangeStart,
    rangeEnd,
    actionButtons,
  };
}

function applyChapterVerseSelection(bookId, chapter, mode) {
  const controls = getChapterVerseControls(bookId, chapter);
  if (!controls || !controls.verseToggles.length) {
    return;
  }

  if (mode === "all") {
    controls.verseToggles.forEach((toggle) => {
      toggle.checked = true;
    });
  }

  if (mode === "clear") {
    controls.verseToggles.forEach((toggle) => {
      toggle.checked = false;
    });
  }

  if (mode === "range") {
    const maxVerse = Number(controls.verseToggles[0].dataset.totalVerses || controls.verseToggles.length);
    const rawStart = Number(controls.rangeStart?.value);
    const rawEnd = Number(controls.rangeEnd?.value);

    if (!Number.isInteger(rawStart) || !Number.isInteger(rawEnd)) {
      setStatus("Enter valid range start and end verse numbers.", "warn");
      return;
    }

    const start = Math.max(1, Math.min(maxVerse, Math.min(rawStart, rawEnd)));
    const end = Math.max(1, Math.min(maxVerse, Math.max(rawStart, rawEnd)));

    controls.verseToggles.forEach((toggle) => {
      const verse = Number(toggle.dataset.verse);
      toggle.checked = verse >= start && verse <= end;
    });

    if (controls.rangeStart) {
      controls.rangeStart.value = String(start);
    }
    if (controls.rangeEnd) {
      controls.rangeEnd.value = String(end);
    }
  }

  updateChapterVerseSummary(bookId, chapter);
  syncScopeFromControls();
  queueRealtimeGenerate();
}

function setChapterVerseControlsEnabled(bookId, chapter, enabled) {
  const controls = getChapterVerseControls(bookId, chapter);
  if (!controls) {
    return;
  }

  controls.details.classList.toggle("is-disabled", !enabled);
  if (!enabled) {
    controls.details.open = false;
  }

  controls.verseToggles.forEach((toggle) => {
    toggle.disabled = !enabled;
  });

  if (controls.rangeStart) {
    controls.rangeStart.disabled = !enabled;
  }
  if (controls.rangeEnd) {
    controls.rangeEnd.disabled = !enabled;
  }
  controls.actionButtons.forEach((button) => {
    button.disabled = !enabled;
  });
}

function wireScopeEvents() {
  el.scopeSelector.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.dataset.role === "book-toggle") {
      const bookId = target.dataset.bookId;
      const chapterToggles = el.scopeSelector.querySelectorAll(
        `input[data-role="chapter-toggle"][data-book-id="${bookId}"]`
      );
      chapterToggles.forEach((toggle) => {
        toggle.checked = target.checked;
        setChapterVerseControlsEnabled(bookId, Number(toggle.dataset.chapter), target.checked);
      });
    }

    if (target.dataset.role === "chapter-toggle") {
      const bookId = target.dataset.bookId;
      const chapter = Number(target.dataset.chapter);
      setChapterVerseControlsEnabled(bookId, chapter, target.checked);
    }

    if (target.dataset.role === "verse-toggle") {
      const bookId = target.dataset.bookId;
      const chapter = Number(target.dataset.chapter);
      updateChapterVerseSummary(bookId, chapter);
    }

    syncScopeFromControls();
    queueRealtimeGenerate();
  });

  el.scopeSelector.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }

    const bookId = target.dataset.bookId;
    const chapter = Number(target.dataset.chapter);
    if (!bookId || !Number.isInteger(chapter)) {
      return;
    }

    if (target.dataset.role === "verse-select-all") {
      applyChapterVerseSelection(bookId, chapter, "all");
    }

    if (target.dataset.role === "verse-clear-all") {
      applyChapterVerseSelection(bookId, chapter, "clear");
    }

    if (target.dataset.role === "verse-apply-range") {
      applyChapterVerseSelection(bookId, chapter, "range");
    }
  });
}

function buildSettingsLabel() {
  const year = getActiveYear();
  return `Year ${year?.name || "Unknown"}`;
}

function buildScopeLabel() {
  const scope = getScopeForActive();
  const active = getActiveProfile(appState.storage);
  const selectedVerses = active.selectedVerses || {};
  const parts = [];

  for (const book of appState.manifest.books) {
    const selectedChapters = [...(scope[book.id] || [])].sort((a, b) => a - b);
    if (!selectedChapters.length) {
      continue;
    }

    const chapterRanges = [];
    const verseParts = [];

    for (const chapter of selectedChapters) {
      const selectedForChapter = selectedVerses[chapterScopeKey(book.id, chapter)];
      if (!Array.isArray(selectedForChapter)) {
        chapterRanges.push(chapter);
        continue;
      }

      if (!selectedForChapter.length) {
        verseParts.push(`${chapter}(none)`);
        continue;
      }

      verseParts.push(`${chapter}(v${formatNumberRanges(selectedForChapter)})`);
    }

    const chapterLabel = formatNumberRanges(chapterRanges);
    const details = [];
    if (chapterLabel) {
      details.push(chapterLabel);
    }
    details.push(...verseParts);

    parts.push(details.length ? `${book.name} ${details.join(", ")}` : book.name);
  }

  return parts.length ? `Scope ${parts.join("; ")}` : "Scope None selected";
}

function selectedPeople() {
  const selectedIds = appState.storage.selectedPrintPeopleIds;
  return appState.storage.profiles.filter((profile) => selectedIds.includes(profile.id));
}

function openPrintView() {
  if (!appState.generatedQuestions.length) {
    setStatus("Generate questions first before opening print view.", "warn");
    return;
  }

  const sheets = createPrintSheets(
    el.printTemplate,
    appState.generatedQuestions,
    selectedPeople(),
    buildSettingsLabel(),
    buildScopeLabel()
  );

  el.printRoot.innerHTML = "";
  el.printRoot.append(sheets);

  document.body.classList.add("printing");
  window.print();
  document.body.classList.remove("printing");
  el.printRoot.innerHTML = "";
}

function updatePreviewToggleText() {
  el.togglePreviewBtn.textContent = el.previewPanel.hidden ? "Show Preview" : "Hide Preview";
}

function togglePreview() {
  el.previewPanel.hidden = !el.previewPanel.hidden;
  updatePreviewToggleText();
}

async function downloadPowerPoint() {
  if (!appState.generatedQuestions.length) {
    setStatus("Generate questions first before exporting PowerPoint.", "warn");
    return;
  }

  const active = getActiveProfile(appState.storage);
  const year = getActiveYear();

  try {
    await exportPowerPoint({
      questions: appState.generatedQuestions,
      yearName: year?.name || "Current Year",
      activePersonName: active.name,
    });
    setStatus("PowerPoint download started.", "ok");
  } catch (error) {
    setStatus(error.message || "PowerPoint export failed.", "warn");
  }
}

function evaluateAnswer(question, answer) {
  const typed = normalizeText(answer);
  const expected = normalizeText(question.answer);

  if (question.type === "true_false") {
    return typed === expected;
  }

  if (question.type === "how_many") {
    const typedNumber = typed.match(/\d+/)?.[0] || "";
    const expectedNumber = expected.match(/\d+/)?.[0] || "";
    return typedNumber && typedNumber === expectedNumber;
  }

  if (typed === expected) {
    return true;
  }

  return expected.includes(typed) && typed.length >= 4;
}

function bindInteractiveControls() {
  const submitBtn = document.getElementById("interactiveSubmitBtn");
  const revealBtn = document.getElementById("interactiveRevealBtn");
  const skipBtn = document.getElementById("interactiveSkipBtn");
  const input = document.getElementById("interactiveAnswerInput");
  const feedback = document.getElementById("interactiveFeedback");

  if (!submitBtn || !revealBtn || !skipBtn || !input || !feedback) {
    return;
  }

  const question = appState.interactive.questions[appState.interactive.index];
  const answerBlock = formatInteractiveAnswer(question);

  submitBtn.addEventListener("click", () => {
    const correct = evaluateAnswer(question, input.value);
    if (correct) {
      appState.interactive.correctCount += 1;
      feedback.textContent = "Correct.";
      feedback.style.color = "#166534";
    } else {
      feedback.textContent = `${answerBlock.answer}\n${answerBlock.reference}`;
      feedback.style.color = "#9a3412";
      feedback.style.whiteSpace = "pre-line";
    }
    setTimeout(nextInteractiveQuestion, 600);
  });

  revealBtn.addEventListener("click", () => {
    feedback.textContent = `${answerBlock.answer}\n${answerBlock.reference}`;
    feedback.style.color = "#5e5853";
    feedback.style.whiteSpace = "pre-line";
  });

  skipBtn.addEventListener("click", () => {
    nextInteractiveQuestion();
  });
}

function nextInteractiveQuestion() {
  appState.interactive.index += 1;
  if (appState.interactive.index >= appState.interactive.questions.length) {
    appState.interactive.complete = true;
  }
  renderInteractive(el.interactiveContainer, appState.interactive);
  if (!appState.interactive.complete) {
    bindInteractiveControls();
  }
}

function startInteractiveQuiz() {
  if (!appState.generatedQuestions.length) {
    setStatus("Generate questions first before starting interactive mode.", "warn");
    return;
  }

  appState.interactive = {
    questions: appState.generatedQuestions,
    index: 0,
    correctCount: 0,
    complete: false,
  };

  el.interactivePanel.hidden = false;
  renderInteractive(el.interactiveContainer, appState.interactive);
  bindInteractiveControls();
  setStatus("Interactive quiz started.", "ok");
}

async function generateAndRender() {
  syncSettingsFromControls();
  syncScopeFromControls();

  const active = getActiveProfile(appState.storage);
  const year = getActiveYear();
  const scope = getScopeForActive();

  const result = await generateQuestions({
    dataService,
    year,
    selectedScope: scope,
    selectedVerses: active.selectedVerses || {},
    settings: active.settings,
    seed: Date.now(),
  });

  appState.generatedQuestions = result.questions;
  appState.unmet = result.unmet;

  renderQuestionBankStats(result.stats);
  renderPreview(el.previewList, el.questionCardTemplate, result.questions);
  renderPreviewMeta(el.previewMeta, result.questions, active.settings, result.unmet);

  if (result.questions.length) {
    setStatus(`Generated ${result.questions.length} questions.`, "ok");
  } else {
    setStatus("No questions generated. Adjust filters and try again.", "warn");
  }
}

function wireEvents() {
  el.togglePreviewBtn.addEventListener("click", togglePreview);

  el.printBtn.addEventListener("click", openPrintView);
  el.pptBtn.addEventListener("click", downloadPowerPoint);
  el.startInteractiveBtn.addEventListener("click", startInteractiveQuiz);

  el.newProfileBtn.addEventListener("click", () => {
    const profile = addProfile(appState.storage, "");
    profile.name = `Person ${appState.storage.profiles.length}`;
    saveState(appState.storage);
    renderProfileArea();
    renderControls();
    refreshScopeThenGenerate();
    setStatus("Created a new person profile.", "ok");
  });

  el.deleteProfileBtn.addEventListener("click", () => {
    const removed = deleteActiveProfile(appState.storage);
    if (!removed) {
      setStatus("At least one profile must remain.", "warn");
      return;
    }
    saveState(appState.storage);
    renderProfileArea();
    renderControls();
    refreshScopeThenGenerate();
    setStatus("Deleted active profile.", "ok");
  });

  el.saveProfileBtn.addEventListener("click", () => {
    const active = getActiveProfile(appState.storage);
    active.name = el.profileNameInput.value.trim() || active.name;
    syncSettingsFromControls();
    syncScopeFromControls();
    saveState(appState.storage);
    renderProfileArea();
    queueRealtimeGenerate();
    setStatus("Saved active profile settings.", "ok");
  });

  el.activeProfileSelect.addEventListener("change", () => {
    appState.storage.activeProfileId = el.activeProfileSelect.value;
    ensureProfileState();
    saveState(appState.storage);
    renderProfileArea();
    renderControls();
    refreshScopeThenGenerate();
  });

  el.printPeopleSelector.addEventListener("change", () => {
    const selected = Array.from(
      el.printPeopleSelector.querySelectorAll('input[type="checkbox"]:checked')
    ).map((checkbox) => checkbox.value);

    if (!selected.length) {
      const active = getActiveProfile(appState.storage);
      selected.push(active.id);
      const activeCheckbox = el.printPeopleSelector.querySelector(`input[value="${active.id}"]`);
      if (activeCheckbox) {
        activeCheckbox.checked = true;
      }
    }

    appState.storage.selectedPrintPeopleIds = selected;
    saveState(appState.storage);
  });

  el.typeCheckboxes.addEventListener("change", () => {
    syncSettingsFromControls();
    refreshScopeThenGenerate();
  });

  el.difficultyCheckboxes.addEventListener("change", () => {
    syncSettingsFromControls();
    refreshScopeThenGenerate();
  });

  el.yearSelect.addEventListener("change", () => {
    const active = getActiveProfile(appState.storage);
    active.settings.yearId = el.yearSelect.value;
    active.selectedScope = structuredClone(getActiveYear()?.scope || {});
    active.selectedVerses = {};
    saveState(appState.storage);
    renderControls();
    refreshScopeThenGenerate();
  });

  [el.totalCountInput, el.perVerseInput, el.humanReviewedOnlyInput].forEach(
    (control) => {
      control.addEventListener("change", () => {
        syncSettingsFromControls();
        refreshScopeThenGenerate();
      });
    }
  );

  wireScopeEvents();
}

async function bootstrap() {
  try {
    appState.manifest = await dataService.loadManifest();
    appState.years = await dataService.loadYears(appState.manifest);

    ensureProfileState();

    const active = getActiveProfile(appState.storage);
    if (!active.settings.yearId || !appState.years.some((year) => year.id === active.settings.yearId)) {
      active.settings.yearId = appState.years[0].id;
    }

    if (!Object.keys(active.selectedScope).length) {
      active.selectedScope = structuredClone(appState.years[0].scope);
    }

    renderProfileArea();
    renderControls();
    updatePreviewToggleText();
    await refreshScopeSelectorForFilters();
    wireEvents();
    await generateAndRender();

    setStatus("Ready. Questions update automatically as you change selections.", "ok");
    saveState(appState.storage);
  } catch (error) {
    setStatus(`${error.message}. If running from file://, regenerate local bundle first.`, "warn");
  }
}

bootstrap();
