import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

/**
 * Simple on-disk JSON cache stored under ~/.launchpad/cache/.
 * Each file mirrors its path in the state repo (e.g. config.json).
 * A companion `.sha` file tracks the remote SHA for conflict detection.
 */
export class LocalCache {
  private readonly root: string;

  constructor(root?: string) {
    this.root = root ?? join(homedir(), ".launchpad", "cache");
  }

  /** Read a cached file. Returns null if not cached. */
  async read(path: string): Promise<{ content: string; sha: string } | null> {
    const filePath = this.resolve(path);
    const shaPath = filePath + ".sha";
    if (!existsSync(filePath) || !existsSync(shaPath)) return null;
    const [content, sha] = await Promise.all([
      readFile(filePath, "utf-8"),
      readFile(shaPath, "utf-8"),
    ]);
    return { content, sha: sha.trim() };
  }

  /** Write content + sha to the cache. */
  async write(path: string, content: string, sha: string): Promise<void> {
    const filePath = this.resolve(path);
    await mkdir(dirname(filePath), { recursive: true });
    await Promise.all([
      writeFile(filePath, content, "utf-8"),
      writeFile(filePath + ".sha", sha, "utf-8"),
    ]);
  }

  /** Resolve a repo-relative path to its local cache path. */
  private resolve(path: string): string {
    return join(this.root, path);
  }
}
