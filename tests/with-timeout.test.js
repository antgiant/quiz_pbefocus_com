import { describe, expect, it } from "vitest";
import { withTimeout } from "../assets/js/utils.js";

describe("withTimeout", () => {
  it("passes through a promise that settles in time", async () => {
    expect(await withTimeout(Promise.resolve("done"), 50, "late")).toBe("done");
  });

  it("falls back when the promise never settles", async () => {
    expect(await withTimeout(new Promise(() => {}), 20, "late")).toBe("late");
  });

  it("falls back when the promise rejects", async () => {
    expect(await withTimeout(Promise.reject(new Error("no")), 50, "late")).toBe("late");
  });
});
