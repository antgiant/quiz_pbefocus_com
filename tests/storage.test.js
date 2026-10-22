import { beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEY } from "../assets/js/constants.js";
import {
  SCHEMA_VERSION,
  addImportedProfiles,
  addProfile,
  deleteActiveProfile,
  getActiveProfile,
  loadState,
  moveProfile,
  saveState,
} from "../assets/js/storage.js";

function stateWithPeople(...names) {
  const state = loadState();
  state.profiles[0].name = names[0];
  for (const name of names.slice(1)) addProfile(state, name);
  return state;
}

const order = (state) => state.profiles.map((profile) => profile.name);

beforeEach(() => localStorage.clear());

describe("loadState", () => {
  it("creates a first person with fill-in-the-blank defaults", () => {
    const state = loadState();
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0].settings.fillInBlank).toMatchObject({ mode: "difficulty" });
    expect(state.profiles[0].settings.typeWeights).toEqual({});
  });

  it("gives each new person their own settings object", () => {
    const state = stateWithPeople("A", "B");
    state.profiles[0].settings.fillInBlank.mode = "custom";
    expect(state.profiles[1].settings.fillInBlank.mode).toBe("difficulty");
  });

  it("upgrades older saved state", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        activeProfileId: "a",
        profiles: [{ id: "a", name: "Old", settings: {}, selectedScope: {} }],
        selectedPrintPeopleIds: ["a"],
      })
    );
    const state = loadState();
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(state.profiles[0].name).toBe("Old");
  });

  it("recovers from damaged storage", () => {
    localStorage.setItem(STORAGE_KEY, "{nope");
    expect(loadState().profiles).toHaveLength(1);
  });

  it("round-trips", () => {
    const state = stateWithPeople("A", "B");
    saveState(state);
    expect(order(loadState())).toEqual(["A", "B"]);
  });
});

describe("moveProfile", () => {
  it("moves a person to a new position", () => {
    const state = stateWithPeople("A", "B", "C", "D");
    expect(moveProfile(state, state.profiles[3].id, 0)).toBe(true);
    expect(order(state)).toEqual(["D", "A", "B", "C"]);
    expect(moveProfile(state, state.profiles[0].id, 2)).toBe(true);
    expect(order(state)).toEqual(["A", "B", "D", "C"]);
  });

  it("clamps the target and ignores no-ops and unknown people", () => {
    const state = stateWithPeople("A", "B", "C");
    expect(moveProfile(state, state.profiles[0].id, 99)).toBe(true);
    expect(order(state)).toEqual(["B", "C", "A"]);
    expect(moveProfile(state, state.profiles[2].id, 2)).toBe(false);
    expect(moveProfile(state, "missing", 0)).toBe(false);
    expect(moveProfile(state, state.profiles[1].id, -5)).toBe(true);
    expect(order(state)).toEqual(["C", "B", "A"]);
  });

  it("keeps who is active and who prints", () => {
    const state = stateWithPeople("A", "B");
    const active = state.activeProfileId;
    state.selectedPrintPeopleIds = [state.profiles[0].id];
    moveProfile(state, state.profiles[0].id, 1);
    expect(state.activeProfileId).toBe(active);
    expect(state.selectedPrintPeopleIds).toEqual([state.profiles[1].id]);
  });
});

describe("importing and deleting", () => {
  it("adds imported people, makes the first active and includes them in printing", () => {
    const state = stateWithPeople("A");
    const imported = [
      { id: "x", name: "X", settings: {}, selectedScope: {} },
      { id: "y", name: "Y", settings: {}, selectedScope: {} },
    ];
    expect(addImportedProfiles(state, imported)).toBe(true);
    expect(order(state)).toEqual(["A", "X", "Y"]);
    expect(state.activeProfileId).toBe("x");
    expect(state.selectedPrintPeopleIds).toEqual(expect.arrayContaining(["x", "y"]));
    expect(addImportedProfiles(state, [])).toBe(false);
  });

  it("deleting the active person falls back to the first", () => {
    const state = stateWithPeople("A", "B");
    expect(deleteActiveProfile(state)).toBe(true);
    expect(getActiveProfile(state).name).toBe("A");
    expect(deleteActiveProfile(state)).toBe(false);
  });
});
