import { DEFAULT_SETTINGS, QUESTION_TYPES } from "./constants.js";
import { DataService } from "./data-service.js";
import { exportPowerPoint } from "./exporters.js";
import { generateQuestions } from "./quiz-engine.js";
import {
  createPrintSheets,
  renderInteractive,
  renderPeopleSelector,
  renderPreview,
  renderPreviewMeta,
  renderProfiles,
  renderScopeSelector,
  renderTypeCheckboxes,
  renderYearOptions,
} from "./renderers.js";
import {
  addProfile,
  deleteActiveProfile,
  getActiveProfile,
  loadState,
  saveState,
} from "./storage.js";
import { formatInteractiveAnswer } from "./question-formatters.js";
import { normalizeText } from "./utils.js";

const DIFFICULTY_POINTS_MAP = {
  easy: [1],
  medium: [2],
  hard: [5],
};

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
  difficultySelect: document.getElementById("difficultySelect"),
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

function ensureProfileState() {
  const active = getActiveProfile(appState.storage);
  active.settings = { ...DEFAULT_SETTINGS, ...active.settings };

  if (!Array.isArray(active.settings.selectedTypes) || !active.settings.selectedTypes.length) {
    active.settings.selectedTypes = [...QUESTION_TYPES];
  }

  if (!active.selectedScope || typeof active.selectedScope !== "object") {
    active.selectedScope = {};
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

  renderYearOptions(el.yearSelect, appState.years);
  el.yearSelect.value = settings.yearId;
  el.totalCountInput.value = settings.totalCount;
  el.perVerseInput.value = settings.perVerse;
  el.difficultySelect.value = settings.difficulty;
  el.humanReviewedOnlyInput.checked = settings.humanReviewedOnly;

  renderTypeCheckboxes(el.typeCheckboxes, QUESTION_TYPES, settings.selectedTypes);
  renderScopeSelector(el.scopeSelector, appState.manifest, getScopeForActive());
}

function questionMatchesAvailabilityFilters(question, settings) {
  const typeSet = new Set(settings.selectedTypes || []);
  if (!typeSet.has(question.type)) {
    return false;
  }

  if (settings.humanReviewedOnly && question.validatedBy !== "human") {
    return false;
  }

  if (settings.difficulty !== "all") {
    const allowedPoints = DIFFICULTY_POINTS_MAP[settings.difficulty] || [];
    if (!allowedPoints.includes(question.points)) {
      return false;
    }
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

  if (!settings.selectedTypes || settings.selectedTypes.length === 0) {
    active.selectedScope = {};
    saveState(appState.storage);
    renderScopeSelector(el.scopeSelector, appState.manifest, {}, {
      chapterAvailability: new Map(),
      hideUnavailable: true,
    });
    return;
  }

  const shouldFilterAvailability =
    settings.humanReviewedOnly ||
    settings.difficulty !== "all" ||
    settings.selectedTypes.length < QUESTION_TYPES.length;

  if (!shouldFilterAvailability) {
    renderScopeSelector(el.scopeSelector, appState.manifest, scope);
    return;
  }

  const availability = await buildAvailabilityMap(settings);
  const prunedScope = pruneScopeToAvailability(scope, availability);

  active.selectedScope = prunedScope;
  saveState(appState.storage);

  renderScopeSelector(el.scopeSelector, appState.manifest, prunedScope, {
    chapterAvailability: availability,
    hideUnavailable: true,
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
  active.settings.difficulty = el.difficultySelect.value;
  active.settings.humanReviewedOnly = el.humanReviewedOnlyInput.checked;

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
  });

  active.selectedScope = scope;
  saveState(appState.storage);
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
      });
    }

    syncScopeFromControls();
    queueRealtimeGenerate();
  });
}

function buildSettingsLabel() {
  const year = getActiveYear();
  return `Year ${year?.name || "Unknown"}`;
}

function formatChapterRanges(chapters) {
  const sorted = [...chapters].sort((a, b) => a - b);
  const ranges = [];
  let start = null;
  let previous = null;

  for (const chapter of sorted) {
    if (start === null) {
      start = chapter;
      previous = chapter;
      continue;
    }

    if (chapter === previous + 1) {
      previous = chapter;
      continue;
    }

    ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = chapter;
    previous = chapter;
  }

  if (start !== null) {
    ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
  }

  return ranges.join(", ");
}

function buildScopeLabel() {
  const scope = getScopeForActive();
  const parts = [];

  for (const book of appState.manifest.books) {
    const selectedChapters = scope[book.id] || [];
    if (!selectedChapters.length) {
      continue;
    }

    const chapterLabel = formatChapterRanges(selectedChapters);
    parts.push(chapterLabel ? `${book.name} ${chapterLabel}` : book.name);
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
    settings: active.settings,
    seed: Date.now(),
  });

  appState.generatedQuestions = result.questions;
  appState.unmet = result.unmet;

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

  el.yearSelect.addEventListener("change", () => {
    const active = getActiveProfile(appState.storage);
    active.settings.yearId = el.yearSelect.value;
    active.selectedScope = structuredClone(getActiveYear()?.scope || {});
    saveState(appState.storage);
    renderControls();
    refreshScopeThenGenerate();
  });

  [el.totalCountInput, el.perVerseInput, el.difficultySelect, el.humanReviewedOnlyInput].forEach(
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

    const total = dataService.countQuestionsInManifest(appState.manifest);
    el.questionBankStats.textContent = `${total} questions across ${appState.manifest.books.length} books`;

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
