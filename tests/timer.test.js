import { describe, expect, it } from "vitest";
import { roundTimeUp, secondsForQuestion } from "../assets/js/question-formatters.js";

const NAD = { first: 30, additional: 10 };
const NEARPOD = { ...NAD, roundTo: 15 };
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

  it("never rounds a Nearpod time below the NAD time", () => {
    for (let points = 1; points <= 30; points += 1) {
      expect(seconds(points, NEARPOD)).toBeGreaterThanOrEqual(seconds(points, NAD));
      expect(seconds(points, NEARPOD) % 15).toBe(0);
    }
  });

  it("treats missing points as one point", () => {
    expect(secondsForQuestion({}, NEARPOD)).toBe(30);
  });

  it("leaves other timers untouched", () => {
    expect(seconds(3, { first: 10, additional: 5 })).toBe(20);
  });
});
