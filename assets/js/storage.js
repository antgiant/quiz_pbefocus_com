import {
  DEFAULT_PERSON_NAME,
  DEFAULT_SETTINGS,
  QUESTION_TYPE_GROUP_IDS,
  STORAGE_KEY,
} from "./constants.js";

// 2: profiles gained fill-in-the-blank and question-type-mix settings
export const SCHEMA_VERSION = 2;

function createDefaultProfile(name = DEFAULT_PERSON_NAME) {
  return {
    id: crypto.randomUUID(),
    name,
    settings: {
      ...DEFAULT_SETTINGS,
      selectedTypes: [...QUESTION_TYPE_GROUP_IDS],
      fillInBlank: { ...DEFAULT_SETTINGS.fillInBlank },
      typeWeights: {},
    },
    selectedScope: {},
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const profile = createDefaultProfile();
      return {
        schemaVersion: SCHEMA_VERSION,
        activeProfileId: profile.id,
        profiles: [profile],
        selectedPrintPeopleIds: [profile.id],
      };
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.profiles) || parsed.profiles.length === 0) {
      throw new Error("Invalid saved profile state");
    }

    parsed.schemaVersion = SCHEMA_VERSION;
    return parsed;
  } catch {
    const profile = createDefaultProfile();
    return {
      schemaVersion: SCHEMA_VERSION,
      activeProfileId: profile.id,
      profiles: [profile],
      selectedPrintPeopleIds: [profile.id],
    };
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function addProfile(state, name) {
  const profile = createDefaultProfile(name || `Person ${state.profiles.length + 1}`);
  state.profiles.push(profile);
  state.activeProfileId = profile.id;
  if (!state.selectedPrintPeopleIds.includes(profile.id)) {
    state.selectedPrintPeopleIds.push(profile.id);
  }
  return profile;
}

// Adds ready-made profiles after the existing people and makes the first one active
export function addImportedProfiles(state, profiles) {
  if (!profiles.length) {
    return false;
  }
  state.profiles.push(...profiles);
  state.activeProfileId = profiles[0].id;
  state.selectedPrintPeopleIds = [...new Set([...state.selectedPrintPeopleIds, ...profiles.map((p) => p.id)])];
  return true;
}

export function deleteActiveProfile(state) {
  if (state.profiles.length <= 1) {
    return false;
  }

  const index = state.profiles.findIndex((profile) => profile.id === state.activeProfileId);
  if (index < 0) {
    return false;
  }

  const [removed] = state.profiles.splice(index, 1);
  state.selectedPrintPeopleIds = state.selectedPrintPeopleIds.filter((id) => id !== removed.id);
  state.activeProfileId = state.profiles[0].id;

  if (state.selectedPrintPeopleIds.length === 0) {
    state.selectedPrintPeopleIds = [state.activeProfileId];
  }

  return true;
}

// Moves a person to `toIndex` in the list (0-based, position after the move)
export function moveProfile(state, id, toIndex) {
  const from = state.profiles.findIndex((profile) => profile.id === id);
  if (from < 0) {
    return false;
  }

  const to = Math.max(0, Math.min(toIndex, state.profiles.length - 1));
  if (from === to) {
    return false;
  }

  const [profile] = state.profiles.splice(from, 1);
  state.profiles.splice(to, 0, profile);
  return true;
}

export function getActiveProfile(state) {
  return state.profiles.find((profile) => profile.id === state.activeProfileId) || state.profiles[0];
}
