import {
  AUDIO_CUE_KEYS,
  AUDIO_STYLES,
  audioCueKey,
  DEFAULT_AUDIO_STYLE,
  DEFAULT_FILL_IN_BLANK,
  DEFAULT_SETTINGS,
  QUESTION_DIFFICULTIES,
  QUESTION_SOURCES,
  QUESTION_TYPE_GROUP_IDS,
  normalizeSelectedTypeGroups,
  questionTypeGroupId,
} from "./constants.js";
import { validateCustomBlanks } from "./blank-engine.js";
import { launchConfetti } from "./confetti.js";
import { DataService } from "./data-service.js";
import { exportPowerPoint } from "./exporters.js";
import { generateQuestions, reblankQuestions } from "./quiz-engine.js";
import {
  createPrintSheets,
  gradeBlanks,
  interactivePossiblePoints,
  interactiveProgressText,
  interactiveTimerText,
  renderDifficultyCheckboxes,
  renderInteractive,
  renderPeopleList,
  renderPreview,
  renderPreviewMeta,
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
  moveProfile,
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
  fibContext: null,
  generationRun: 0,
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
  deleteProfileBtn: document.getElementById("deleteProfileBtn"),
  profileNameInput: document.getElementById("profileNameInput"),
  peopleList: document.getElementById("peopleList"),
  peopleAnnouncer: document.getElementById("peopleAnnouncer"),
  typeMixHelp: document.getElementById("typeMixHelp"),
  fillInBlankFieldset: document.getElementById("fillInBlankFieldset"),
  blankModeRadios: document.querySelectorAll('input[name="blankMode"]'),
  blankCustomFields: document.getElementById("blankCustomFields"),
  blankUnitCountBtn: document.getElementById("blankUnitCountBtn"),
  blankUnitPercentBtn: document.getElementById("blankUnitPercentBtn"),
  blankMinLabel: document.getElementById("blankMinLabel"),
  blankMaxLabel: document.getElementById("blankMaxLabel"),
  blankMinInput: document.getElementById("blankMinInput"),
  blankMaxInput: document.getElementById("blankMaxInput"),
  blankError: document.getElementById("blankError"),
  blankCustomNote: document.getElementById("blankCustomNote"),
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

  active.settings.selectedTypes = normalizeSelectedTypeGroups(active.settings.selectedTypes);
  if (!active.settings.selectedTypes.length) {
    active.settings.selectedTypes = [...QUESTION_TYPE_GROUP_IDS];
  }
  if (!active.settings.difficultyWeights || typeof active.settings.difficultyWeights !== "object") {
    active.settings.difficultyWeights = {};
  }
  if (!active.settings.typeWeights || typeof active.settings.typeWeights !== "object") {
    active.settings.typeWeights = {};
  }
  active.settings.fillInBlank = { ...DEFAULT_FILL_IN_BLANK, ...(active.settings.fillInBlank || {}) };

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

// Start from everything the year covers, including verse ranges within a chapter
function seedScopeFromYear(active) {
  const year = getActiveYear(active);
  active.selectedScope = structuredClone(year?.scope || {});
  active.selectedVerses = structuredClone(year?.verses || {});
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
    settings.selectedDifficulties,
    settings.difficultyWeights
  );
  renderSourceCheckboxes(el.sourceCheckboxes, QUESTION_SOURCES, settings.selectedSources);
  renderTypeCheckboxes(el.typeCheckboxes, QUESTION_TYPE_GROUP_IDS, settings.selectedTypes, settings.typeWeights);
  renderFillInBlankControls(settings);
  renderScopeSelector(el.scopeSelector, appState.manifest, getScopeForActive(), {
    scopeLimit: getActiveYear()?.scope || {},
    selectorMode: settings.selectorMode,
    chapterWeights: active.chapterWeights,
    selectedVerses: active.selectedVerses,
  });
  el.scopeSelector.scrollTop = 0;
  updateSelectorModeControls(settings.selectorMode);
}

// --- Fill in the Blank settings ---

function renderFillInBlankControls(settings) {
  const config = settings.fillInBlank;
  const visible = settings.selectedTypes.includes("fill_in_blank");
  el.fillInBlankFieldset.hidden = !visible;
  el.typeMixHelp.hidden = settings.selectedTypes.length < 2;

  el.blankModeRadios.forEach((radio) => {
    radio.checked = radio.value === config.mode;
  });
  el.blankCustomFields.hidden = config.mode !== "custom";

  const percent = config.unit === "percent";
  el.blankUnitCountBtn.classList.toggle("is-active", !percent);
  el.blankUnitPercentBtn.classList.toggle("is-active", percent);
  el.blankUnitCountBtn.setAttribute("aria-pressed", percent ? "false" : "true");
  el.blankUnitPercentBtn.setAttribute("aria-pressed", percent ? "true" : "false");
  el.blankMinLabel.textContent = percent ? "Smallest percent of words" : "Fewest blanks";
  el.blankMaxLabel.textContent = percent ? "Largest percent of words" : "Most blanks";
  el.blankMinInput.max = percent ? "100" : "";
  el.blankMaxInput.max = percent ? "100" : "";
  el.blankMinInput.value = String(percent ? config.minPercent : config.minBlanks);
  el.blankMaxInput.value = String(percent ? config.maxPercent : config.maxBlanks);
  el.blankCustomNote.textContent = percent
    ? "Each verse blanks a random share between these, rounded to whole words. Questions are still labelled easy, medium or hard by the share blanked, and only the difficulties you ticked are used."
    : "Each verse blanks a random number of words between these (never more than the verse has). Questions are still labelled easy, medium or hard by the share blanked, and only the difficulties you ticked are used.";
  showBlankErrors(config);
}

function showBlankErrors(config) {
  const errors = validateCustomBlanks(config);
  const showing = config.mode === "custom";
  el.blankError.textContent = showing ? errors.max || errors.min || "" : "";
  el.blankMinInput.setAttribute("aria-invalid", showing && errors.min ? "true" : "false");
  el.blankMaxInput.setAttribute("aria-invalid", showing && errors.max ? "true" : "false");
  return showing ? Object.keys(errors).length === 0 : true;
}

function syncFillInBlankFromControls(settings) {
  const config = { ...DEFAULT_FILL_IN_BLANK, ...(settings.fillInBlank || {}) };
  const checked = Array.from(el.blankModeRadios).find((radio) => radio.checked);
  config.mode = checked?.value === "custom" ? "custom" : "difficulty";

  const min = Number(el.blankMinInput.value);
  const max = Number(el.blankMaxInput.value);
  if (config.unit === "percent") {
    config.minPercent = min;
    config.maxPercent = max;
  } else {
    config.minBlanks = min;
    config.maxBlanks = max;
  }
  settings.fillInBlank = config;
  return showBlankErrors(config);
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
  if (!typeSet.has(questionTypeGroupId(question.type))) {
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

  // Fill-in-the-blank is made from the verses themselves, so every chapter qualifies
  if (settings.selectedTypes.includes("fill_in_blank") && settings.selectedDifficulties.length > 0) {
    for (const book of appState.manifest.books) {
      for (const chapter of book.chapters) {
        availability.set(`${book.id}:${chapter.number}`, true);
      }
    }
    return availability;
  }

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
    settings.selectedTypes.length < QUESTION_TYPE_GROUP_IDS.length;

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
  const active = getActiveProfile(appState.storage);
  el.profileNameInput.value = active.name;

  renderPeopleList(
    el.peopleList,
    appState.storage.profiles,
    appState.storage.activeProfileId,
    appState.storage.selectedPrintPeopleIds
  );
}

function announcePeople(message) {
  el.peopleAnnouncer.textContent = "";
  // Re-setting the text on the next frame makes screen readers repeat a message
  window.requestAnimationFrame(() => {
    el.peopleAnnouncer.textContent = message;
  });
}

function activateProfile(id) {
  appState.storage.activeProfileId = id;
  ensureProfileState();
  saveState(appState.storage);
  renderProfileArea();
  renderControls();
  refreshScopeThenGenerate();
}

function reorderPerson(id, toIndex, focusRole = null) {
  if (!moveProfile(appState.storage, id, toIndex)) {
    return;
  }
  saveState(appState.storage);
  renderProfileArea();

  const profiles = appState.storage.profiles;
  const position = profiles.findIndex((profile) => profile.id === id);
  const row = el.peopleList.querySelector(`.person-row[data-id="${id}"]`);
  const target =
    (focusRole && row?.querySelector(`[data-role="${focusRole}"]:not(:disabled)`)) ||
    row?.querySelector(".person-move:not(:disabled)");
  target?.focus();
  announcePeople(`${profiles[position].name} moved to position ${position + 1} of ${profiles.length}.`);
}

// Where a dragged person would land: before or after the row under the pointer
function dropTarget(event) {
  const row = event.target.closest?.(".person-row");
  if (!row) {
    return null;
  }
  const box = row.getBoundingClientRect();
  return { row, after: event.clientY > box.top + box.height / 2 };
}

function clearDropMarkers() {
  el.peopleList.querySelectorAll(".drop-before, .drop-after, .is-dragging").forEach((node) => {
    node.classList.remove("drop-before", "drop-after", "is-dragging");
  });
}

function wirePeopleList() {
  let draggedId = null;

  el.peopleList.addEventListener("change", (event) => {
    const target = event.target;
    if (target.name === "activePerson") {
      activateProfile(target.value);
      return;
    }

    if (target.dataset.role === "person-print") {
      const selected = Array.from(
        el.peopleList.querySelectorAll('input[data-role="person-print"]:checked')
      ).map((checkbox) => checkbox.value);

      if (!selected.length) {
        selected.push(appState.storage.activeProfileId);
        const activeBox = el.peopleList.querySelector(
          `input[data-role="person-print"][value="${appState.storage.activeProfileId}"]`
        );
        if (activeBox) {
          activeBox.checked = true;
        }
      }

      appState.storage.selectedPrintPeopleIds = selected;
      saveState(appState.storage);
    }
  });

  el.peopleList.addEventListener("click", (event) => {
    const button = event.target.closest?.(".person-move");
    if (!button) {
      return;
    }
    const row = button.closest(".person-row");
    const index = appState.storage.profiles.findIndex((profile) => profile.id === row.dataset.id);
    const up = button.dataset.role === "move-up";
    reorderPerson(row.dataset.id, index + (up ? -1 : 1), button.dataset.role);
  });

  el.peopleList.addEventListener("dragstart", (event) => {
    const row = event.target.closest?.(".person-row");
    if (!row || event.target !== row) {
      return;
    }
    draggedId = row.dataset.id;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedId);
    row.classList.add("is-dragging");
  });

  el.peopleList.addEventListener("dragover", (event) => {
    if (!draggedId) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const target = dropTarget(event);
    el.peopleList.querySelectorAll(".drop-before, .drop-after").forEach((node) => {
      node.classList.remove("drop-before", "drop-after");
    });
    if (target && target.row.dataset.id !== draggedId) {
      target.row.classList.add(target.after ? "drop-after" : "drop-before");
    }
  });

  el.peopleList.addEventListener("drop", (event) => {
    if (!draggedId) {
      return;
    }
    event.preventDefault();
    const target = dropTarget(event);
    const id = draggedId;
    draggedId = null;
    clearDropMarkers();
    if (!target || target.row.dataset.id === id) {
      return;
    }

    const ids = appState.storage.profiles.map((profile) => profile.id).filter((other) => other !== id);
    const targetIndex = ids.indexOf(target.row.dataset.id);
    reorderPerson(id, targetIndex + (target.after ? 1 : 0));
  });

  el.peopleList.addEventListener("dragend", () => {
    draggedId = null;
    clearDropMarkers();
  });
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
  const difficultyWeights = {};
  el.difficultyCheckboxes.querySelectorAll('input[data-role="difficulty-weight"]').forEach((input) => {
    const value = parseFloat(input.value);
    if (!input.disabled && Number.isFinite(value) && value >= 0) {
      difficultyWeights[input.dataset.difficulty] = Math.min(value, 100);
    }
  });
  active.settings.difficultyWeights = difficultyWeights;

  active.settings.selectedTypes = Array.from(
    el.typeCheckboxes.querySelectorAll('input[type="checkbox"]:checked')
  ).map((checkbox) => checkbox.value);
  const typeWeights = {};
  el.typeCheckboxes.querySelectorAll('input[data-role="type-weight"]').forEach((input) => {
    const value = parseFloat(input.value);
    if (!input.disabled && Number.isFinite(value) && value >= 0) {
      typeWeights[input.dataset.type] = Math.min(value, 100);
    }
  });
  active.settings.typeWeights = typeWeights;
  syncFillInBlankFromControls(active.settings);

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
  const previousVerses = active.selectedVerses || {};

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

    // Chapter mode shows no verse boxes: keep any verse choices (e.g. from the year) as they were
    if (!verseToggles.length) {
      const kept = previousVerses[chapterScopeKey(bookId, chapter)];
      if (Array.isArray(kept)) {
        selectedVerses[chapterScopeKey(bookId, chapter)] = kept;
      }
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
// than one request per verse, retrying since the Bible API can drop requests.
function loadChapterVerses(bookId, chapter) {
  return dataService.loadNkjvChapterWithRetry(bookId, chapter);
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
// audio is an AUDIO_STYLES key or null, realistic auto-submits the answer at time's up
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
    const missing = verses.filter((list, index) => !list.length && !questions[index].generated).length;
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
  const wasComplete = state.complete;
  state.complete = index >= state.questions.length;
  if (state.complete && !wasComplete) {
    launchConfetti();
  }
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

// Same verses, different words blanked, in a new order
function practiceAgain() {
  const state = appState.interactive;
  const seed = Date.now();
  stopQuestionTimer();
  const questions = shuffle(reblankQuestions(state.questions, state.fibContext, seed), seed);
  appState.interactive = {
    ...state,
    questions,
    index: 0,
    complete: false,
    timerRun: null,
    results: questions.map(newInteractiveResult),
  };
  showInteractive();
  setStatus("New blanks ready. Same verses, different words.", "ok");
}

function newInteractiveResult() {
  return {
    input: "",
    status: "unanswered",
    autoCorrect: false,
    awarded: 0,
    remainingMs: null,
    expired: false,
    playedTen: false,
    playedUp: false,
  };
}

function bindInteractiveControls() {
  const state = appState.interactive;
  const prevBtn = document.getElementById("interactivePrevBtn");

  if (state.complete) {
    prevBtn?.addEventListener("click", () => goToInteractiveQuestion(state.questions.length - 1));
    document.getElementById("interactivePracticeAgainBtn")?.addEventListener("click", practiceAgain);
    return;
  }

  const submitBtn = document.getElementById("interactiveSubmitBtn");
  const revealBtn = document.getElementById("interactiveRevealBtn");
  const nextBtn = document.getElementById("interactiveNextBtn");
  const panel = document.getElementById("interactiveAnswerPanel");

  const index = state.index;
  const question = state.questions[index];
  const result = state.results[index];
  const isBlankQuiz = Boolean(question.segments);
  const input = document.getElementById("interactiveAnswerInput");
  const blankInputs = Array.from(el.interactiveContainer.querySelectorAll(".fib-input"));

  if (!submitBtn || !revealBtn || !nextBtn || !prevBtn || !panel || (!isBlankQuiz && !input)) {
    return;
  }

  // Generated questions already carry their verse; written ones fetch the full text
  if (result.status !== "unanswered" && !isBlankQuiz) {
    fillInteractiveVerse(question, index);
  }

  // Re-render so the answer panel and running score reflect the new state
  const refresh = () => {
    showInteractive();
    document.getElementById("interactiveAnswerPanel")?.scrollIntoView({ block: "nearest" });
  };

  const readBlanks = () => blankInputs.map((box) => box.value);

  if (isBlankQuiz) {
    blankInputs.forEach((box, boxIndex) => {
      box.addEventListener("input", () => {
        result.inputs[boxIndex] = box.value;
      });
      // Enter moves along the blanks and submits from the last one
      box.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        const next = blankInputs.slice(boxIndex + 1).find((other) => !other.readOnly);
        if (next) {
          next.focus();
        } else {
          submitBtn.click();
        }
      });
    });
    if (result.status === "unanswered" && !result.expired) {
      blankInputs.find((box) => !box.readOnly && !box.value)?.focus({ preventScroll: true });
    }
  } else {
    input.addEventListener("input", () => {
      result.input = input.value;
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        submitBtn.click();
      }
    });
  }

  // Returns false when the click was ignored (nothing changed)
  const submitAnswer = () => {
    // Realistic mode: no late answers once time is up or the question was left
    if (state.options.realistic && result.expired && !result.autoSubmit) {
      return false;
    }

    if (isBlankQuiz) {
      const values = readBlanks();
      if (result.status === "submitted") {
        return false;
      }
      result.inputs = values;
      result.status = "submitted";
      // Blanks filled by a hint hold the right word, so hints never change the score
      result.blankCorrect = gradeBlanks(question, values);
      result.autoCorrect = result.blankCorrect.every(Boolean);
      result.awarded = result.blankCorrect.filter(Boolean).length;
      return true;
    }

    // Re-submitting the same text must not wipe points the user already adjusted
    if (result.status === "submitted" && result.submittedInput === input.value) {
      return false;
    }
    result.input = input.value;
    result.submittedInput = input.value;
    result.status = "submitted";
    result.autoCorrect = Boolean(evaluateAnswer(question, input.value));
    result.awarded = result.autoCorrect ? interactivePossiblePoints(question) : 0;
    return true;
  };

  submitBtn.addEventListener("click", () => {
    if (submitAnswer()) {
      refresh();
    }
  });

  document.getElementById("interactiveHintBtn")?.addEventListener("click", () => {
    if (result.status !== "unanswered") return;
    result.inputs = readBlanks();
    const open = question.blankWords.map((_, i) => i).filter((i) => !result.hinted.includes(i));
    const next = open.find((i) => !result.inputs[i]?.trim()) ?? open[0];
    if (next === undefined) return;
    result.inputs[next] = question.blankWords[next];
    result.hinted.push(next);
    refresh();
  });

  revealBtn.addEventListener("click", () => {
    if (result.status === "unanswered") {
      if (isBlankQuiz) {
        result.inputs = readBlanks();
      }
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
  // Moving on counts as submitting whatever is in the box
  nextBtn.addEventListener("click", () => {
    if (result.status === "unanswered") {
      submitAnswer();
    }
    goToInteractiveQuestion(index + 1);
  });
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
        result.autoSubmit = true;
        document.getElementById("interactiveSubmitBtn")?.click();
        result.autoSubmit = false;
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
    fibContext: appState.fibContext,
    index: 0,
    options,
    audioElements,
    timerRun: null,
    results: appState.generatedQuestions.map(newInteractiveResult),
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

  const config = active.settings.fillInBlank;
  if (active.settings.selectedTypes.includes("fill_in_blank") && config.mode === "custom") {
    if (Object.keys(validateCustomBlanks(config)).length) {
      setStatus("Fix the Fill in the Blank settings to generate questions.", "warn");
      return;
    }
  }

  // Verse downloads can take a moment, so only the newest request may update the page
  appState.generationRun += 1;
  const run = appState.generationRun;
  const usesVerses = active.settings.selectedTypes.includes("fill_in_blank");
  if (usesVerses) {
    setStatus("Preparing fill-in-the-blank questions…");
  }

  const result = await generateQuestions({
    dataService,
    year,
    selectedScope: scope,
    selectedVerses: active.selectedVerses || {},
    chapterWeights: active.chapterWeights || {},
    settings: active.settings,
    seed: Date.now(),
    onProgress: ({ done, total }) => {
      if (run === appState.generationRun && done < total) {
        setStatus(`Downloading verses… ${done} of ${total} chapters ready`);
      }
    },
  });

  if (run !== appState.generationRun) {
    return;
  }

  appState.generatedQuestions = result.questions;
  appState.fibContext = result.fibContext || null;
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
    el.profileNameInput.focus();
    el.profileNameInput.select();
    setStatus("Created a new person. Type a name above.", "ok");
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

  // Names save as you type; settings and scope already save as they change
  el.profileNameInput.addEventListener("input", () => {
    const active = getActiveProfile(appState.storage);
    const name = el.profileNameInput.value.trim();
    if (!name) {
      return;
    }
    active.name = name;
    saveState(appState.storage);
    const label = el.peopleList.querySelector(`.person-row[data-id="${active.id}"] .person-name`);
    if (label) {
      label.textContent = name;
    }
  });

  el.profileNameInput.addEventListener("blur", () => {
    el.profileNameInput.value = getActiveProfile(appState.storage).name;
    renderProfileArea();
  });

  wirePeopleList();

  el.typeCheckboxes.addEventListener("change", (event) => {
    if (event.target.dataset.role === "type-weight") {
      syncSettingsFromControls();
      queueRealtimeGenerate();
      return;
    }
    // Keep each percent box enabled only while its type is checked
    el.typeCheckboxes.querySelectorAll("label").forEach((label) => {
      const box = label.querySelector('input[type="checkbox"]');
      const weight = label.querySelector('input[data-role="type-weight"]');
      if (weight) weight.disabled = !box.checked;
    });
    syncSettingsFromControls();
    renderFillInBlankControls(getActiveProfile(appState.storage).settings);
    refreshScopeThenGenerate();
  });

  el.blankModeRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      syncSettingsFromControls();
      renderFillInBlankControls(getActiveProfile(appState.storage).settings);
      queueRealtimeGenerate();
    });
  });

  const setBlankUnit = (unit) => {
    const settings = getActiveProfile(appState.storage).settings;
    if (settings.fillInBlank.unit === unit) {
      return;
    }
    syncSettingsFromControls();
    settings.fillInBlank.unit = unit;
    saveState(appState.storage);
    renderFillInBlankControls(settings);
    queueRealtimeGenerate();
  };
  el.blankUnitCountBtn.addEventListener("click", () => setBlankUnit("count"));
  el.blankUnitPercentBtn.addEventListener("click", () => setBlankUnit("percent"));

  [el.blankMinInput, el.blankMaxInput].forEach((input) => {
    // Show problems while typing, but only regenerate once the values are valid
    input.addEventListener("input", () => {
      syncSettingsFromControls();
    });
    input.addEventListener("change", () => {
      if (syncFillInBlankFromControls(getActiveProfile(appState.storage).settings)) {
        saveState(appState.storage);
        queueRealtimeGenerate();
      }
    });
  });

  el.difficultyCheckboxes.addEventListener("change", (event) => {
    if (event.target.dataset.role === "difficulty-weight") {
      syncSettingsFromControls();
      queueRealtimeGenerate();
      return;
    }
    // Keep each percent box enabled only while its difficulty is checked
    el.difficultyCheckboxes.querySelectorAll("label").forEach((label) => {
      const box = label.querySelector('input[type="checkbox"]');
      const weight = label.querySelector('input[data-role="difficulty-weight"]');
      if (weight) weight.disabled = !box.checked;
    });
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
    seedScopeFromYear(active);
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
      seedScopeFromYear(active);
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
