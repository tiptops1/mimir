import { describe, expect, it } from "vitest";
import { canReserve } from "./index-budget";

describe("canReserve", () => {
  it("allows reservation under the cap", () => {
    expect(canReserve(0, 3)).toBe(true);
    expect(canReserve(2, 3)).toBe(true);
  });

  it("blocks reservation at or over the cap", () => {
    expect(canReserve(3, 3)).toBe(false);
    expect(canReserve(4, 3)).toBe(false);
  });
});
