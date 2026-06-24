import {
  DEFAULT_PERSON_NAME,
  DEFAULT_SETTINGS,
  QUESTION_TYPES,
  STORAGE_KEY,
} from "./constants.js";

function createDefaultProfile(name = DEFAULT_PERSON_NAME) {
  return {
    id: crypto.randomUUID(),
    name,
    settings: { ...DEFAULT_SETTINGS, selectedTypes: [...QUESTION_TYPES] },
    selectedScope: {},
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const profile = createDefaultProfile();
      return {
        schemaVersion: 1,
        activeProfileId: profile.id,
        profiles: [profile],
        selectedPrintPeopleIds: [profile.id],
      };
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.profiles) || parsed.profiles.length === 0) {
      throw new Error("Invalid saved profile state");
    }

    return parsed;
  } catch {
    const profile = createDefaultProfile();
    return {
      schemaVersion: 1,
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

export function getActiveProfile(state) {
  return state.profiles.find((profile) => profile.id === state.activeProfileId) || state.profiles[0];
}
