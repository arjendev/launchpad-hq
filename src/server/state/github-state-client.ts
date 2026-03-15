import type { GitHubFileInfo } from "./types.js";

const API = "https://api.github.com";
const USER_AGENT = "launchpad-hq";
const API_VERSION = "2022-11-28";
const DEFAULT_STATE_REPO = "launchpad-state";

/** Low-level client for the user's launchpad-state GitHub repo. */
export class GitHubStateClient {
  private readonly repoName: string;

  constructor(
    private readonly token: string,
    private readonly owner: string,
    repo?: string,
  ) {
    this.repoName = repo ?? DEFAULT_STATE_REPO;
  }

  get repo(): string {
    return this.repoName;
  }

  // ---- repo lifecycle -------------------------------------------------------

  /** Returns true if launchpad-state repo already exists. */
  async repoExists(): Promise<boolean> {
    const res = await this.request(
      "GET",
      `/repos/${this.owner}/${this.repoName}`,
    );
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    throw await this.apiError("repoExists", res);
  }

  /** Creates the launchpad-state repo (private). */
  async createRepo(): Promise<void> {
    const res = await this.request("POST", "/user/repos", {
      name: this.repoName,
      description: "State store for launchpad-hq",
      private: true,
      auto_init: true, // creates initial commit so we can push files
    });
    if (res.status !== 201) {
      throw await this.apiError("createRepo", res);
    }
  }

  /** Ensure the repo exists — create it if missing. */
  async ensureRepo(): Promise<void> {
    if (!(await this.repoExists())) {
      await this.createRepo();
    }
  }

  // ---- file operations ------------------------------------------------------

  /**
   * Read a file from the state repo.
   * Returns null if the file doesn't exist (404).
   */
  async readFile(path: string): Promise<GitHubFileInfo | null> {
    const res = await this.request(
      "GET",
      `/repos/${this.owner}/${this.repoName}/contents/${path}`,
    );
    if (res.status === 404) return null;
    if (!res.ok) throw await this.apiError("readFile", res);

    const data = (await res.json()) as {
      sha: string;
      content: string;
      path: string;
    };
    const decoded = Buffer.from(data.content, "base64").toString("utf-8");
    return { sha: data.sha, content: decoded, path: data.path };
  }

  /**
   * Create or update a file in the state repo.
   * Provide `sha` when updating an existing file (required by GitHub API).
   */
  async writeFile(
    path: string,
    content: string,
    sha?: string,
    message?: string,
  ): Promise<string> {
    const body: Record<string, string> = {
      message: message ?? `chore: update ${path}`,
      content: Buffer.from(content, "utf-8").toString("base64"),
    };
    if (sha) body.sha = sha;

    const res = await this.request(
      "PUT",
      `/repos/${this.owner}/${this.repoName}/contents/${path}`,
      body,
    );
    if (res.status !== 200 && res.status !== 201) {
      throw await this.apiError("writeFile", res);
    }
    const data = (await res.json()) as { content: { sha: string } };
    return data.content.sha;
  }

  // ---- internal helpers -----------------------------------------------------

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const opts: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": USER_AGENT,
        "X-GitHub-Api-Version": API_VERSION,
      },
    };
    if (body) {
      opts.body = JSON.stringify(body);
      (opts.headers as Record<string, string>)["Content-Type"] =
        "application/json";
    }
    return fetch(`${API}${path}`, opts);
  }

  private async apiError(
    operation: string,
    res: Response,
  ): Promise<Error> {
    let detail = "";
    try {
      const json = (await res.json()) as { message?: string };
      detail = json.message ?? "";
    } catch {
      /* ignore parse errors */
    }
    return new Error(
      `GitHub state API error [${operation}]: ${res.status} ${detail}`.trim(),
    );
  }
}
