import {
  AUDIO_CUE_KEYS,
  AUDIO_STYLES,
  audioCueKey,
  DEFAULT_AUDIO_STYLE,
  DEFAULT_SETTINGS,
  QUESTION_DIFFICULTIES,
  QUESTION_SOURCES,
  QUESTION_TYPES,
} from "./constants.js";
import { DataService } from "./data-service.js";
import { exportPowerPoint } from "./exporters.js";
import { generateQuestions } from "./quiz-engine.js";
import {
  createPrintSheets,
  interactivePossiblePoints,
  interactiveProgressText,
  interactiveTimerText,
  renderDifficultyCheckboxes,
  renderInteractive,
  renderPeopleSelector,
  renderPreview,
  renderPreviewMeta,
  renderProfiles,
  renderSourceCheckboxes,
  renderScopeSelector,
  renderTypeCheckboxes,
  renderVerseText,
  renderYearOptionsWithScope,
} from "./renderers.js";
import {
  addProfile,
  deleteActiveProfile,
  getActiveProfile,
  loadState,
  saveState,
} from "./storage.js";
import { formatInteractiveAnswer, secondsForQuestion } from "./question-formatters.js";
import { formatNumberRanges, normalizeText, shuffle, questionMatchesSelectedSources } from "./utils.js";

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
    results: [],
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
  sourceCheckboxes: document.getElementById("sourceCheckboxes"),
  typeCheckboxes: document.getElementById("typeCheckboxes"),
  scopeSelector: document.getElementById("scopeSelector"),
  regenerateBtn: document.getElementById("regenerateBtn"),
  resetWeightsBtn: document.getElementById("resetWeightsBtn"),
  scopeModeChapterBtn: document.getElementById("scopeModeChapterBtn"),
  scopeModeVerseBtn: document.getElementById("scopeModeVerseBtn"),
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

function normalizeSelectedSources(selectedSources, legacyHumanReviewedOnly) {
  if (Array.isArray(selectedSources)) {
    return selectedSources.filter((source) => QUESTION_SOURCES.includes(source));
  }

  if (legacyHumanReviewedOnly === true) {
    return ["ai_human_reviewed", "human_generated"];
  }

  return [...QUESTION_SOURCES];
}

function ensureProfileState() {
  const active = getActiveProfile(appState.storage);
  const savedSelectedDifficulties = active.settings?.selectedDifficulties;
  const savedDifficulty = active.settings?.difficulty;
  const savedSelectedSources = active.settings?.selectedSources;
  const savedHumanReviewedOnly = active.settings?.humanReviewedOnly;
  active.settings = { ...DEFAULT_SETTINGS, ...active.settings };
  active.settings.selectedDifficulties = normalizeSelectedDifficulties(
    savedSelectedDifficulties,
    savedDifficulty
  );
  active.settings.selectedSources = normalizeSelectedSources(
    savedSelectedSources,
    savedHumanReviewedOnly
  );
  delete active.settings.difficulty;
  delete active.settings.humanReviewedOnly;

  if (!Array.isArray(active.settings.selectedTypes) || !active.settings.selectedTypes.length) {
    active.settings.selectedTypes = [...QUESTION_TYPES];
  }

  if (!active.selectedScope || typeof active.selectedScope !== "object") {
    active.selectedScope = {};
  }

  if (!active.selectedVerses || typeof active.selectedVerses !== "object") {
    active.selectedVerses = {};
  }

  if (active.settings.selectorMode !== "chapter" && active.settings.selectorMode !== "verse") {
    active.settings.selectorMode = "chapter";
  }

  if (!Array.isArray(appState.storage.selectedPrintPeopleIds)) {
    appState.storage.selectedPrintPeopleIds = [active.id];
  }
}

function getActiveYear(active = getActiveProfile(appState.storage)) {
  return appState.years.find((year) => year.id === active.settings.yearId) || appState.years[0] || null;
}

function getScopeForActive(active = getActiveProfile(appState.storage)) {
  const year = getActiveYear(active);
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

  renderDifficultyCheckboxes(
    el.difficultyCheckboxes,
    QUESTION_DIFFICULTIES,
    settings.selectedDifficulties
  );
  renderSourceCheckboxes(el.sourceCheckboxes, QUESTION_SOURCES, settings.selectedSources);
  renderTypeCheckboxes(el.typeCheckboxes, QUESTION_TYPES, settings.selectedTypes);
  renderScopeSelector(el.scopeSelector, appState.manifest, getScopeForActive(), {
    scopeLimit: getActiveYear()?.scope || {},
    selectorMode: settings.selectorMode,
    chapterWeights: active.chapterWeights,
    selectedVerses: active.selectedVerses,
  });
  el.scopeSelector.scrollTop = 0;
  updateSelectorModeControls(settings.selectorMode);
}

function updateSelectorModeControls(mode) {
  const normalizedMode = mode === "verse" ? "verse" : "chapter";
  const chapterActive = normalizedMode === "chapter";

  el.scopeModeChapterBtn.classList.toggle("is-active", chapterActive);
  el.scopeModeVerseBtn.classList.toggle("is-active", !chapterActive);

  el.scopeModeChapterBtn.setAttribute("aria-pressed", chapterActive ? "true" : "false");
  el.scopeModeVerseBtn.setAttribute("aria-pressed", chapterActive ? "false" : "true");
}

function chapterScopeKey(bookId, chapter) {
  return `${bookId}:${chapter}`;
}

function getSelectedVersesForChapter(bookId, chapter) {
  const active = getActiveProfile(appState.storage);
  const selected = active.selectedVerses?.[chapterScopeKey(bookId, chapter)];
  if (!Array.isArray(selected)) {
    return null;
  }

  return selected
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => a - b);
}

function scheduleNkjvLoadForChapter(bookId, chapter) {
  const active = getActiveProfile(appState.storage);
  const selectedChapters = active.selectedScope?.[bookId] || [];
  if (!selectedChapters.includes(chapter)) {
    return;
  }

  const selectedVerses = getSelectedVersesForChapter(bookId, chapter);
  if (Array.isArray(selectedVerses) && selectedVerses.length === 0) {
    return;
  }

  dataService.preloadNkjvForSelection(bookId, chapter, selectedVerses).catch((error) => {
    console.warn(`Unable to load NKJV data for ${bookId} ${chapter}`, error);
  });
}

function scheduleNkjvLoadsForBook(bookId) {
  const active = getActiveProfile(appState.storage);
  const selectedChapters = active.selectedScope?.[bookId] || [];
  for (const chapter of selectedChapters) {
    scheduleNkjvLoadForChapter(bookId, chapter);
  }
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

  if (!questionMatchesSelectedSources(question, settings.selectedSources)) {
    return false;
  }

  if (!difficultySet.has(question.difficulty)) {
    return false;
  }

  return true;
}

async function buildAvailabilityMap(settings) {
  const availability = new Map();

  await Promise.all(
    appState.manifest.books.flatMap((book) =>
      book.chapters.map(async (chapter) => {
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
      })
    )
  );

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
    settings.selectedDifficulties.length === 0 ||
    !settings.selectedSources ||
    settings.selectedSources.length === 0
  ) {
    active.selectedScope = {};
    active.selectedVerses = {};
    saveState(appState.storage);
    renderScopeSelector(el.scopeSelector, appState.manifest, {}, {
      chapterAvailability: new Map(),
      hideUnavailable: true,
      scopeLimit: getActiveYear()?.scope || {},
      selectorMode: settings.selectorMode,
    chapterWeights: active.chapterWeights,
      selectedVerses: {},
    });
    return;
  }

  const shouldFilterAvailability =
    settings.selectedSources.length < QUESTION_SOURCES.length ||
    settings.selectedDifficulties.length < QUESTION_DIFFICULTIES.length ||
    settings.selectedTypes.length < QUESTION_TYPES.length;

  if (!shouldFilterAvailability) {
    renderScopeSelector(el.scopeSelector, appState.manifest, scope, {
      scopeLimit: getActiveYear()?.scope || {},
      selectorMode: settings.selectorMode,
    chapterWeights: active.chapterWeights,
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
    scopeLimit: getActiveYear()?.scope || {},
    selectorMode: settings.selectorMode,
    chapterWeights: active.chapterWeights,
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
  active.settings.selectedSources = Array.from(
    el.sourceCheckboxes.querySelectorAll('input[type="checkbox"]:checked')
  ).map((checkbox) => checkbox.value);
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

  const chapterWeights = {};
  el.scopeSelector.querySelectorAll('[data-role="chapter-weight"]').forEach((input) => {
    const value = parseFloat(input.value);
    if (input.disabled || !Number.isFinite(value) || value < 0) {
      return;
    }
    chapterWeights[chapterScopeKey(input.dataset.bookId, input.dataset.chapter)] = Math.min(value, 100);
  });

  active.selectedScope = scope;
  active.selectedVerses = selectedVerses;
  active.chapterWeights = chapterWeights;
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
  scheduleNkjvLoadForChapter(bookId, chapter);
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

function setChapterWeightEnabled(bookId, chapter, enabled) {
  const input = el.scopeSelector.querySelector(
    `input[data-role="chapter-weight"][data-book-id="${bookId}"][data-chapter="${chapter}"]`
  );
  if (input) {
    input.disabled = !enabled;
  }
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
        setChapterWeightEnabled(bookId, Number(toggle.dataset.chapter), target.checked);
      });
    }

    if (target.dataset.role === "chapter-toggle") {
      const bookId = target.dataset.bookId;
      const chapter = Number(target.dataset.chapter);
      setChapterVerseControlsEnabled(bookId, chapter, target.checked);
      setChapterWeightEnabled(bookId, chapter, target.checked);
    }

    if (target.dataset.role === "verse-toggle") {
      const bookId = target.dataset.bookId;
      const chapter = Number(target.dataset.chapter);
      updateChapterVerseSummary(bookId, chapter);
    }

    syncScopeFromControls();

    if (target.dataset.role === "book-toggle" && target.checked) {
      scheduleNkjvLoadsForBook(target.dataset.bookId);
    }

    if (target.dataset.role === "chapter-toggle" && target.checked) {
      scheduleNkjvLoadForChapter(target.dataset.bookId, Number(target.dataset.chapter));
    }

    if (target.dataset.role === "verse-toggle" && target.checked) {
      scheduleNkjvLoadForChapter(target.dataset.bookId, Number(target.dataset.chapter));
    }

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

function buildSettingsLabel(active = getActiveProfile(appState.storage)) {
  const year = getActiveYear(active);
  return `Year ${year?.name || "Unknown"}`;
}

function buildScopeLabel(active = getActiveProfile(appState.storage)) {
  const scope = getScopeForActive(active);
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

// Questions for every selected person; the active profile reuses the
// already-generated set, others are generated from their own profile.
async function buildSelectedPeopleEntries() {
  const activeId = getActiveProfile(appState.storage).id;
  return Promise.all(
    selectedPeople().map(async (profile) => {
      let questions = appState.generatedQuestions;
      if (profile.id !== activeId) {
        const result = await generateQuestions({
          dataService,
          year: getActiveYear(profile),
          selectedScope: getScopeForActive(profile),
          selectedVerses: profile.selectedVerses || {},
          chapterWeights: profile.chapterWeights || {},
          settings: profile.settings,
          seed: Date.now() + Math.floor(Math.random() * 1e6),
        });
        questions = result.questions;
      }
      return {
        person: profile,
        questions,
        settingsLabel: buildSettingsLabel(profile),
        scopeLabel: buildScopeLabel(profile),
      };
    })
  );
}

async function openPrintView() {
  if (!appState.generatedQuestions.length) {
    setStatus("Generate questions first before opening print view.", "warn");
    return;
  }

  let entries;
  try {
    entries = await buildSelectedPeopleEntries();
  } catch (error) {
    setStatus(error.message, "warn");
    return;
  }

  const sheets = createPrintSheets(el.printTemplate, entries);

  el.printRoot.innerHTML = "";
  el.printRoot.append(sheets);

  const cleanupPrintView = () => {
    document.body.classList.remove("printing");
    el.printRoot.innerHTML = "";
  };

  window.addEventListener("afterprint", cleanupPrintView, { once: true });
  document.body.classList.add("printing");
  window.print();
}

function updatePreviewToggleText() {
  el.togglePreviewBtn.textContent = el.previewPanel.hidden ? "Show Preview" : "Hide Preview";
}

function togglePreview() {
  el.previewPanel.hidden = !el.previewPanel.hidden;
  updatePreviewToggleText();
}

// Loads whole chapters (shared and de-duplicated by the data service) rather
// than one request per verse, retrying once since the Bible API can drop requests.
async function loadChapterVerses(bookId, chapter) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const verses = await dataService.loadNkjvChapter(bookId, chapter);
      if (verses.length) return verses;
    } catch {
      // retry below
    }
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }
  return [];
}

async function loadVersesForQuestions(questions) {
  const chapters = new Map();
  for (const question of questions) {
    const key = `${question.bookId}:${question.chapter}`;
    if (!chapters.has(key)) {
      chapters.set(key, loadChapterVerses(question.bookId, question.chapter));
    }
  }

  return Promise.all(
    questions.map(async (question) => {
      const chapterVerses = await chapters.get(`${question.bookId}:${question.chapter}`);
      const start = Number(question.startVerse) || 1;
      const end = Math.max(start, Number(question.endVerse) || start);
      return chapterVerses.filter((v) => v.verse >= start && v.verse <= end);
    })
  );
}

const TIMER_PRESETS = {
  florida: { first: 10, additional: 5 },
  nad: { first: 30, additional: 10 },
};

// The PowerPoint and interactive dialogs remember their choices separately
const POWERPOINT_DIALOG = {
  prefKey: "pbe_quiz_timer_pref_v1",
  title: "PowerPoint timer",
  question: "How would you like the timer on the question slide configured?",
  okLabel: "Download",
  showRealistic: false,
};
const INTERACTIVE_DIALOG = {
  prefKey: "pbe_quiz_interactive_timer_pref_v1",
  title: "Interactive quiz timer",
  question: "How would you like the timer on each question configured?",
  okLabel: "Start",
  showRealistic: true,
};

function readTimerPref(prefKey) {
  try {
    return JSON.parse(window.localStorage.getItem(prefKey)) || {};
  } catch {
    return {};
  }
}

function writeTimerPref(prefKey, pref) {
  try {
    window.localStorage.setItem(prefKey, JSON.stringify(pref));
  } catch {
    // Remembering the choice is a convenience only
  }
}

// Resolves to null (cancelled) or { timer, audio, realistic }: timer is null or { first, additional },
// audio is an AUDIO_STYLES key or null, realistic locks the answer box at time's up
// (audio and realistic only apply when there is a timer)
function askTimerOptions(config) {
  const dialog = document.getElementById("timerDialog");
  const form = document.getElementById("timerForm");
  const customFields = document.getElementById("timerCustomFields");
  const firstInput = document.getElementById("timerFirstInput");
  const extraInput = document.getElementById("timerExtraInput");
  const cancelBtn = document.getElementById("timerCancelBtn");
  const audioGroup = document.getElementById("timerAudioGroup");
  const audioCheck = document.getElementById("timerAudioCheck");
  const audioStyle = document.getElementById("timerAudioStyle");
  const realisticGroup = document.getElementById("timerRealisticGroup");
  const realisticCheck = document.getElementById("timerRealisticCheck");
  const modeInputs = [...form.querySelectorAll('input[name="timerMode"]')];

  document.getElementById("timerDialogTitle").textContent = config.title;
  document.getElementById("timerDialogQuestion").textContent = config.question;
  document.getElementById("timerOkBtn").textContent = config.okLabel;

  const pref = readTimerPref(config.prefKey);
  const mode = modeInputs.some((input) => input.value === pref.mode) ? pref.mode : "none";
  modeInputs.forEach((input) => {
    input.checked = input.value === mode;
  });
  firstInput.value = pref.first ?? TIMER_PRESETS.florida.first;
  extraInput.value = pref.additional ?? TIMER_PRESETS.florida.additional;

  audioStyle.innerHTML = "";
  for (const [key, style] of Object.entries(AUDIO_STYLES)) {
    audioStyle.append(new Option(style.label, key));
  }
  audioStyle.value = AUDIO_STYLES[pref.audioStyle] ? pref.audioStyle : DEFAULT_AUDIO_STYLE;
  audioCheck.checked = Boolean(pref.audioEnabled);
  realisticCheck.checked = Boolean(pref.realistic);

  const selectedMode = () => modeInputs.find((input) => input.checked).value;
  const syncCustom = () => {
    customFields.hidden = selectedMode() !== "custom";
    audioGroup.hidden = selectedMode() === "none";
    realisticGroup.hidden = selectedMode() === "none" || !config.showRealistic;
    audioStyle.disabled = !audioCheck.checked;
  };
  syncCustom();

  return new Promise((resolve) => {
    const finish = (result) => {
      form.removeEventListener("change", syncCustom);
      form.removeEventListener("submit", onSubmit);
      cancelBtn.removeEventListener("click", onCancel);
      dialog.removeEventListener("cancel", onCancel);
      if (dialog.open) dialog.close();
      resolve(result);
    };

    const onCancel = (event) => {
      event.preventDefault();
      finish(null);
    };

    const onSubmit = (event) => {
      event.preventDefault();
      const chosen = selectedMode();
      let timer = null;
      if (chosen === "custom") {
        const first = Math.round(Number(firstInput.value));
        const additional = Math.round(Number(extraInput.value));
        if (!(first >= 1) || !(additional >= 0)) {
          firstInput.reportValidity();
          return;
        }
        timer = { first, additional };
      } else if (chosen !== "none") {
        timer = TIMER_PRESETS[chosen];
      }
      writeTimerPref(config.prefKey, {
        mode: chosen,
        first: Number(firstInput.value),
        additional: Number(extraInput.value),
        audioEnabled: audioCheck.checked,
        audioStyle: audioStyle.value,
        realistic: realisticCheck.checked,
      });
      finish({
        timer,
        audio: timer && audioCheck.checked ? audioStyle.value : null,
        realistic: Boolean(timer && config.showRealistic && realisticCheck.checked),
      });
    };

    form.addEventListener("change", syncCustom);
    form.addEventListener("submit", onSubmit);
    cancelBtn.addEventListener("click", onCancel);
    dialog.addEventListener("cancel", onCancel);
    dialog.showModal();
  });
}

async function downloadPowerPoint() {
  if (!appState.generatedQuestions.length) {
    setStatus("Generate questions first before exporting PowerPoint.", "warn");
    return;
  }

  const options = await askTimerOptions(POWERPOINT_DIALOG);
  if (!options) {
    return;
  }

  try {
    setStatus("Preparing PowerPoint…", "ok");
    const entries = await buildSelectedPeopleEntries();
    const questions = shuffle(
      entries.flatMap((entry) => entry.questions),
      Date.now()
    );
    if (!questions.length) {
      setStatus("No selected people have questions to export.", "warn");
      return;
    }

    const verses = await loadVersesForQuestions(questions);
    const missing = verses.filter((list) => !list.length).length;
    await exportPowerPoint({
      questions,
      verses,
      yearName: getActiveYear()?.name || "Current Year",
      timer: options.timer,
      audio: options.audio,
    });
    setStatus(
      `PowerPoint download started with ${questions.length} questions from ${entries.length} ${entries.length === 1 ? "person" : "people"}.` +
        (missing ? ` Verse text could not be loaded for ${missing} question(s).` : ""),
      missing ? "warn" : "ok"
    );
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

const verseCache = new Map();

function showInteractive() {
  stopQuestionTimer();
  renderInteractive(el.interactiveContainer, appState.interactive);
  bindInteractiveControls();
  startQuestionTimer();
}

// Leaving a timed question without answering counts as the time running out
function expireCurrentQuestion() {
  const state = appState.interactive;
  if (!state.options?.timer || state.complete) return;

  const result = state.results[state.index];
  if (result && result.status === "unanswered" && !result.expired) {
    stopQuestionTimer();
    result.expired = true;
    result.remainingMs = 0;
    result.playedTen = true;
    result.playedUp = true;
  }
}

function goToInteractiveQuestion(index) {
  expireCurrentQuestion();
  const state = appState.interactive;
  state.complete = index >= state.questions.length;
  state.index = Math.max(0, Math.min(index, state.questions.length - 1));
  showInteractive();
}

// Fill in the full verse text under the reference once it has loaded
async function fillInteractiveVerse(question, index) {
  const target = document.getElementById("interactiveVerseText");
  if (!target) {
    return;
  }

  if (!verseCache.has(question)) {
    verseCache.set(question, loadVersesForQuestions([question]).then(([verses]) => verses));
  }

  const verses = await verseCache.get(question);
  const current = document.getElementById("interactiveVerseText");
  if (current && appState.interactive.index === index && !appState.interactive.complete) {
    renderVerseText(current, verses, question.answer);
  }
}

function bindInteractiveControls() {
  const state = appState.interactive;
  const prevBtn = document.getElementById("interactivePrevBtn");

  if (state.complete) {
    prevBtn?.addEventListener("click", () => goToInteractiveQuestion(state.questions.length - 1));
    return;
  }

  const submitBtn = document.getElementById("interactiveSubmitBtn");
  const revealBtn = document.getElementById("interactiveRevealBtn");
  const nextBtn = document.getElementById("interactiveNextBtn");
  const input = document.getElementById("interactiveAnswerInput");
  const panel = document.getElementById("interactiveAnswerPanel");

  if (!submitBtn || !revealBtn || !nextBtn || !prevBtn || !input || !panel) {
    return;
  }

  const index = state.index;
  const question = state.questions[index];
  const result = state.results[index];

  if (result.status !== "unanswered") {
    fillInteractiveVerse(question, index);
  }

  // Re-render so the answer panel and running score reflect the new state
  const refresh = () => {
    showInteractive();
    document.getElementById("interactiveAnswerPanel")?.scrollIntoView({ block: "nearest" });
  };

  input.addEventListener("input", () => {
    result.input = input.value;
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      submitBtn.click();
    }
  });

  submitBtn.addEventListener("click", () => {
    // Re-submitting the same text must not wipe points the user already adjusted
    if (result.status === "submitted" && result.submittedInput === input.value) {
      return;
    }
    result.input = input.value;
    result.submittedInput = input.value;
    result.status = "submitted";
    result.autoCorrect = Boolean(evaluateAnswer(question, input.value));
    result.awarded = result.autoCorrect ? interactivePossiblePoints(question) : 0;
    refresh();
  });

  revealBtn.addEventListener("click", () => {
    if (result.status === "unanswered") {
      result.status = "revealed";
      result.awarded = 0;
    }
    refresh();
  });

  panel.addEventListener("change", (event) => {
    if (event.target.name === "interactivePoints") {
      result.awarded = Number(event.target.value);
      const progress = el.interactiveContainer.querySelector(".interactive-progress");
      if (progress) {
        progress.textContent = interactiveProgressText(state);
      }
    }
  });

  prevBtn.addEventListener("click", () => goToInteractiveQuestion(index - 1));
  nextBtn.addEventListener("click", () => goToInteractiveQuestion(index + 1));
}

// --- Interactive timer ---

function playInteractiveCue(kind) {
  const audio = appState.interactive.audioElements?.[kind];
  if (!audio) return;
  audio.currentTime = 0;
  audio.play().catch(() => {
    // Autoplay can be blocked; the countdown still works without sound
  });
}

function stopInteractiveAudio() {
  for (const audio of Object.values(appState.interactive.audioElements || {})) {
    audio.pause();
  }
}

// Pause the running countdown (keeping the time left) and silence any cue
function stopQuestionTimer() {
  const run = appState.interactive.timerRun;
  if (run) {
    clearInterval(run.handle);
    const result = appState.interactive.results[run.index];
    if (result && !result.expired) {
      result.remainingMs = Math.max(0, run.deadline - Date.now());
    }
    appState.interactive.timerRun = null;
  }
  stopInteractiveAudio();
}

// Count down the current question, resuming from the time left if revisited
function startQuestionTimer() {
  const state = appState.interactive;
  const timer = state.options?.timer;
  if (!timer || state.complete) return;

  const index = state.index;
  const question = state.questions[index];
  const result = state.results[index];
  if (result.status !== "unanswered" || result.expired) return;

  const isLast = index === state.questions.length - 1;
  const totalMs = secondsForQuestion(question, timer) * 1000;
  if (result.remainingMs == null) {
    result.remainingMs = totalMs;
  }

  const deadline = Date.now() + result.remainingMs;
  const tick = () => {
    const remaining = Math.max(0, deadline - Date.now());
    result.remainingMs = remaining;

    const node = document.getElementById("interactiveTimer");
    if (node) {
      node.textContent = interactiveTimerText(result);
      node.classList.toggle("urgent", remaining <= 10000);
    }

    if (state.options.audio && !result.playedTen && totalMs >= 10000 && remaining <= 10000) {
      result.playedTen = true;
      playInteractiveCue(audioCueKey("tenSeconds", isLast));
    }

    if (remaining <= 0) {
      clearInterval(state.timerRun?.handle);
      state.timerRun = null;
      result.expired = true;
      if (node) {
        node.textContent = interactiveTimerText(result);
      }
      if (state.options.audio && !result.playedUp) {
        result.playedUp = true;
        playInteractiveCue(audioCueKey("timesUp", isLast));
      }
      if (state.options.realistic) {
        const input = document.getElementById("interactiveAnswerInput");
        if (input) {
          input.readOnly = true;
          result.input = input.value;
        }
      }
    }
  };

  state.timerRun = { index, deadline, handle: setInterval(tick, 200) };
  tick();
}

async function startInteractiveQuiz() {
  if (!appState.generatedQuestions.length) {
    setStatus("Generate questions first before starting interactive mode.", "warn");
    return;
  }

  const options = await askTimerOptions(INTERACTIVE_DIALOG);
  if (!options) {
    return;
  }

  stopQuestionTimer();

  const audioElements = {};
  if (options.audio) {
    const style = AUDIO_STYLES[options.audio];
    for (const kind of AUDIO_CUE_KEYS) {
      audioElements[kind] = new Audio(style[kind].path);
      audioElements[kind].preload = "auto";
    }
  }

  appState.interactive = {
    questions: appState.generatedQuestions,
    index: 0,
    options,
    audioElements,
    timerRun: null,
    results: appState.generatedQuestions.map(() => ({
      input: "",
      status: "unanswered",
      autoCorrect: false,
      awarded: 0,
      remainingMs: null,
      expired: false,
      playedTen: false,
      playedUp: false,
    })),
    complete: false,
  };

  el.interactivePanel.hidden = false;
  showInteractive();
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
    chapterWeights: active.chapterWeights || {},
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
  el.regenerateBtn.addEventListener("click", () => {
    generateAndRender().catch((error) => setStatus(error.message, "warn"));
  });

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
    if (appState.storage.profiles.length <= 1) {
      setStatus("At least one profile must remain.", "warn");
      return;
    }
    const name = getActiveProfile(appState.storage).name;
    if (!window.confirm(`Delete "${name}"? Their saved settings and scope will be lost and this can't be undone.`)) {
      return;
    }
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

  el.sourceCheckboxes.addEventListener("change", () => {
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

  el.scopeModeChapterBtn.addEventListener("click", () => {
    const active = getActiveProfile(appState.storage);
    if (active.settings.selectorMode === "chapter") {
      return;
    }
    active.settings.selectorMode = "chapter";
    saveState(appState.storage);
    renderControls();
    queueRealtimeGenerate();
  });

  el.scopeModeVerseBtn.addEventListener("click", () => {
    const active = getActiveProfile(appState.storage);
    if (active.settings.selectorMode === "verse") {
      return;
    }
    active.settings.selectorMode = "verse";
    saveState(appState.storage);
    renderControls();
    queueRealtimeGenerate();
  });

  el.resetWeightsBtn.addEventListener("click", () => {
    const active = getActiveProfile(appState.storage);
    active.chapterWeights = {};
    saveState(appState.storage);
    el.scopeSelector.querySelectorAll('[data-role="chapter-weight"]').forEach((input) => {
      input.value = "";
    });
    queueRealtimeGenerate();
  });

  [el.totalCountInput, el.perVerseInput].forEach(
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
      active.selectedScope = structuredClone(getActiveYear()?.scope || {});
    }

    renderProfileArea();
    renderControls();
    updatePreviewToggleText();
    wireEvents();
    await refreshScopeSelectorForFilters();
    await generateAndRender();

    setStatus("Ready. Questions update automatically as you change selections.", "ok");
    saveState(appState.storage);
  } catch (error) {
    setStatus(`${error.message}. If running from file://, regenerate local bundle first.`, "warn");
  }
}

bootstrap();
