import { describe, expect, it } from "vitest";
import { LEGACY_TIMER_MODES, TIMER_PRESETS } from "../assets/js/constants.js";
import { roundTimeUp, roundToNearestStep, secondsForQuestion } from "../assets/js/question-formatters.js";
import steps from "./fixtures/nad-nearpod-steps.json";

const NAD = { first: 30, additional: 10 };
const NEARPOD = { ...NAD, roundTo: 15 };
const NEARPOD_NEAREST = { ...NAD, roundTo: 15, roundMode: "nearest" };
const seconds = (points, timer) => secondsForQuestion({ points }, timer);

describe("roundTimeUp", () => {
  it("leaves whole steps alone", () => {
    expect(roundTimeUp(30, 15)).toBe(30);
    expect(roundTimeUp(60, 15)).toBe(60);
  });

  it("rounds up from a third of a step, down below that", () => {
    expect(roundTimeUp(34, 15)).toBe(30);
    expect(roundTimeUp(35, 15)).toBe(45);
    expect(roundTimeUp(44, 15)).toBe(45);
    expect(roundTimeUp(49, 15)).toBe(45);
    expect(roundTimeUp(50, 15)).toBe(60);
  });

  it("never goes below one step", () => {
    expect(roundTimeUp(3, 15)).toBe(15);
  });
});

describe("secondsForQuestion", () => {
  it("keeps NAD timing exact without a rounding step", () => {
    expect([1, 2, 3, 4, 5, 6].map((points) => seconds(points, NAD))).toEqual([30, 40, 50, 60, 70, 80]);
  });

  it("rounds NAD timing to 15 s steps for Nearpod, up more than down", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((points) => seconds(points, NEARPOD))).toEqual([
      30, 45, 60, 60, 75, 90, 90, 105,
    ]);
  });

  it("keeps the round-up rule from falling below the NAD time", () => {
    for (let points = 1; points <= 30; points += 1) {
      expect(seconds(points, NEARPOD)).toBeGreaterThanOrEqual(seconds(points, NAD));
      expect(seconds(points, NEARPOD) % 15).toBe(0);
    }
  });

  it("can round to the nearest step instead", () => {
    expect(roundToNearestStep(35, 15)).toBe(30);
    expect(roundToNearestStep(40, 15)).toBe(45);
    expect(roundToNearestStep(5, 15)).toBe(15);
    // 30, 40, 50, 60, 70, 80, 90, 100 s, each to the closest step
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((points) => seconds(points, NEARPOD_NEAREST))).toEqual([
      30, 45, 45, 60, 75, 75, 90, 105,
    ]);
  });

  it("treats missing points as one point", () => {
    expect(secondsForQuestion({}, NEARPOD)).toBe(30);
  });

  it("leaves other timers untouched", () => {
    expect(seconds(3, { first: 10, additional: 5 })).toBe(20);
  });
});

describe("the NAD preset against the 2025 and 2026 NAD broadcasts", () => {
  const share = (rows, timer) =>
    rows.filter(([points, step]) => seconds(points, timer) === step).length / rows.length;
  const all = [...steps.y2025, ...steps.y2026];

  it("uses 15 s steps from 30 s plus 5 s per extra point", () => {
    const nad = TIMER_PRESETS.nad;
    expect([1, 2, 3, 4, 5, 6, 7].map((points) => seconds(points, nad))).toEqual([30, 30, 45, 45, 45, 60, 60]);
  });

  it("is the only NAD preset: an old saved Nearpod choice maps to it", () => {
    expect(TIMER_PRESETS.nearpod).toBeUndefined();
    expect(LEGACY_TIMER_MODES.nearpod).toBe("nad");
  });

  it("matches most of the measured questions, and more than the old rule did", () => {
    expect(share(all, TIMER_PRESETS.nad)).toBeGreaterThan(0.8);
    expect(share(steps.y2025, TIMER_PRESETS.nad)).toBeGreaterThan(0.9);
    expect(share(all, TIMER_PRESETS.nad)).toBeGreaterThan(share(all, { first: 30, additional: 10, roundTo: 15 }) + 0.2);
  });
});
