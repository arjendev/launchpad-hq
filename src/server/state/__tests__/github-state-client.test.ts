import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubStateClient } from "../github-state-client.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createClient() {
  return new GitHubStateClient("ghp_test_token", "testuser");
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    headers: new Headers(),
  } as Response;
}

describe("GitHubStateClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- repoExists -----------------------------------------------------------

  describe("repoExists()", () => {
    it("returns true when repo exists", async () => {
      mockFetch.mockResolvedValue(jsonResponse(200, { name: "launchpad-state" }));

      const client = createClient();
      const exists = await client.repoExists();

      expect(exists).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/testuser/launchpad-state",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("returns false when repo does not exist", async () => {
      mockFetch.mockResolvedValue(jsonResponse(404, { message: "Not Found" }));

      const client = createClient();
      const exists = await client.repoExists();

      expect(exists).toBe(false);
    });

    it("throws on unexpected status", async () => {
      mockFetch.mockResolvedValue(jsonResponse(500, { message: "Server error" }));

      const client = createClient();
      await expect(client.repoExists()).rejects.toThrow("GitHub state API error");
    });
  });

  // ---- createRepo -----------------------------------------------------------

  describe("createRepo()", () => {
    it("creates a private repo", async () => {
      mockFetch.mockResolvedValue(jsonResponse(201, { name: "launchpad-state" }));

      const client = createClient();
      await client.createRepo();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/user/repos",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"private":true'),
        }),
      );
    });

    it("throws on failure", async () => {
      mockFetch.mockResolvedValue(jsonResponse(422, { message: "Validation Failed" }));

      const client = createClient();
      await expect(client.createRepo()).rejects.toThrow("GitHub state API error");
    });
  });

  // ---- ensureRepo -----------------------------------------------------------

  describe("ensureRepo()", () => {
    it("does not create when repo already exists", async () => {
      mockFetch.mockResolvedValue(jsonResponse(200, { name: "launchpad-state" }));

      const client = createClient();
      await client.ensureRepo();

      expect(mockFetch).toHaveBeenCalledTimes(1); // Only the existence check
    });

    it("creates repo when it does not exist", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(404, { message: "Not Found" }))
        .mockResolvedValueOnce(jsonResponse(201, { name: "launchpad-state" }));

      const client = createClient();
      await client.ensureRepo();

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // ---- readFile -------------------------------------------------------------

  describe("readFile()", () => {
    it("returns decoded file content", async () => {
      const content = Buffer.from('{"version":1}').toString("base64");
      mockFetch.mockResolvedValue(
        jsonResponse(200, { sha: "abc", content, path: "config.json" }),
      );

      const client = createClient();
      const result = await client.readFile("config.json");

      expect(result).toEqual({
        sha: "abc",
        content: '{"version":1}',
        path: "config.json",
      });
    });

    it("returns null for missing file", async () => {
      mockFetch.mockResolvedValue(jsonResponse(404, { message: "Not Found" }));

      const client = createClient();
      const result = await client.readFile("nope.json");

      expect(result).toBeNull();
    });
  });

  // ---- writeFile ------------------------------------------------------------

  describe("writeFile()", () => {
    it("creates a new file", async () => {
      mockFetch.mockResolvedValue(
        jsonResponse(201, { content: { sha: "new-sha" } }),
      );

      const client = createClient();
      const sha = await client.writeFile("config.json", '{"version":1}');

      expect(sha).toBe("new-sha");
      const body = JSON.parse(
        (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
      );
      expect(body.content).toBe(
        Buffer.from('{"version":1}').toString("base64"),
      );
      expect(body.sha).toBeUndefined();
    });

    it("updates an existing file with sha", async () => {
      mockFetch.mockResolvedValue(
        jsonResponse(200, { content: { sha: "updated-sha" } }),
      );

      const client = createClient();
      const sha = await client.writeFile("config.json", "{}", "old-sha");

      expect(sha).toBe("updated-sha");
      const body = JSON.parse(
        (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
      );
      expect(body.sha).toBe("old-sha");
    });

    it("throws on conflict", async () => {
      mockFetch.mockResolvedValue(jsonResponse(409, { message: "Conflict" }));

      const client = createClient();
      await expect(
        client.writeFile("config.json", "{}", "stale-sha"),
      ).rejects.toThrow("GitHub state API error");
    });
  });
});
