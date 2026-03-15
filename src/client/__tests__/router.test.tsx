import { describe, expect, it } from "vitest";
import { detectRouterBasepath } from "../router";

describe("detectRouterBasepath", () => {
  it("returns undefined for normal app routes", () => {
    expect(detectRouterBasepath("/")).toBeUndefined();
    expect(detectRouterBasepath("/settings")).toBeUndefined();
  });

  it("detects preview-prefixed routes", () => {
    expect(detectRouterBasepath("/preview/arjendev%2Flaunchpad-hq/"))
      .toBe("/preview/arjendev%2Flaunchpad-hq");
    expect(detectRouterBasepath("/preview/arjendev%2Flaunchpad-hq/settings"))
      .toBe("/preview/arjendev%2Flaunchpad-hq");
  });
});
