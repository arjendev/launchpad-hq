import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { getHqToken, setHqToken, clearHqToken, initAuthFromUrl } from "../services/auth.js";

// We need to reset the module-level `hqToken` between tests.
// Re-importing won't help because vitest caches, so we use clearHqToken + sessionStorage.clear.

describe("auth token management", () => {
  beforeEach(() => {
    clearHqToken();
    sessionStorage.clear();
  });

  describe("getHqToken / setHqToken", () => {
    it("returns null when no token is set", () => {
      expect(getHqToken()).toBeNull();
    });

    it("returns the token after setHqToken", () => {
      setHqToken("abc-123");
      expect(getHqToken()).toBe("abc-123");
    });

    it("persists token to sessionStorage", () => {
      setHqToken("persisted-token");
      expect(sessionStorage.getItem("hq-auth-token")).toBe("persisted-token");
    });

    it("falls back to sessionStorage when memory is empty", () => {
      sessionStorage.setItem("hq-auth-token", "from-storage");
      // clearHqToken cleared in-memory but we manually wrote to storage above
      expect(getHqToken()).toBe("from-storage");
    });

    it("caches the sessionStorage value into memory on fallback", () => {
      sessionStorage.setItem("hq-auth-token", "cached-value");
      getHqToken(); // should cache
      sessionStorage.removeItem("hq-auth-token"); // remove from storage
      expect(getHqToken()).toBe("cached-value"); // still returns from memory
    });
  });

  describe("clearHqToken", () => {
    it("clears both memory and sessionStorage", () => {
      setHqToken("to-clear");
      clearHqToken();
      expect(sessionStorage.getItem("hq-auth-token")).toBeNull();
      expect(getHqToken()).toBeNull();
    });
  });

  describe("initAuthFromUrl", () => {
    let replaceStateSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      replaceStateSpy = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
    });

    afterEach(() => {
      replaceStateSpy.mockRestore();
      // Reset URL
      window.history.replaceState(null, "", "/");
    });

    it("extracts token from URL and stores it", () => {
      // Simulate URL with token
      Object.defineProperty(window, "location", {
        value: {
          ...window.location,
          search: "?token=url-token-123",
          pathname: "/",
          hash: "",
        },
        writable: true,
        configurable: true,
      });

      initAuthFromUrl();

      expect(getHqToken()).toBe("url-token-123");
      expect(sessionStorage.getItem("hq-auth-token")).toBe("url-token-123");
    });

    it("restores from sessionStorage when URL has no token", () => {
      sessionStorage.setItem("hq-auth-token", "restored-token");

      Object.defineProperty(window, "location", {
        value: {
          ...window.location,
          search: "",
          pathname: "/",
          hash: "",
        },
        writable: true,
        configurable: true,
      });

      initAuthFromUrl();

      expect(getHqToken()).toBe("restored-token");
    });

    it("URL token takes precedence over sessionStorage", () => {
      sessionStorage.setItem("hq-auth-token", "old-token");

      Object.defineProperty(window, "location", {
        value: {
          ...window.location,
          search: "?token=new-url-token",
          pathname: "/",
          hash: "",
        },
        writable: true,
        configurable: true,
      });

      initAuthFromUrl();

      expect(getHqToken()).toBe("new-url-token");
      expect(sessionStorage.getItem("hq-auth-token")).toBe("new-url-token");
    });
  });
});
