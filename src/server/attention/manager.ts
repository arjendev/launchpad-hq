/**
 * @deprecated The AttentionManager is superseded by the Activity Feed and Status Badges (Phase 4 — #72).
 * Scheduled for removal in a future release.
 */

// ────────────────────────────────────────────────────────
// AttentionManager — stores items, runs evaluation loop
// ────────────────────────────────────────────────────────

import type { GitHubGraphQL } from "../github/graphql.js";
import type { StateService } from "../state/types.js";
import type {
  AttentionItem,
  AttentionConfig,
  AttentionQuery,
} from "./types.js";
import { defaultAttentionConfig } from "./types.js";
import { evaluateProjectAttention } from "./rules.js";

export class AttentionManager {
  private items = new Map<string, AttentionItem>();
  private config: AttentionConfig;
  private evaluationTimer: ReturnType<typeof setInterval> | null = null;
  private graphql: GitHubGraphQL | null = null;
  private stateService: StateService | null = null;
  private broadcastFn: ((items: AttentionItem[]) => void) | null = null;

  constructor(config?: Partial<AttentionConfig>) {
    const defaults = defaultAttentionConfig();
    this.config = {
      ...defaults,
      ...config,
      rules: config?.rules ?? defaults.rules,
    };
  }

  /** Wire up dependencies after construction (avoids circular plugin deps). */
  init(deps: {
    graphql: GitHubGraphQL | null;
    stateService: StateService;
    broadcast: (items: AttentionItem[]) => void;
  }): void {
    this.graphql = deps.graphql;
    this.stateService = deps.stateService;
    this.broadcastFn = deps.broadcast;
  }

  /** Start the periodic evaluation loop. */
  start(): void {
    if (this.evaluationTimer) return;
    // Run immediately, then on interval
    this.runEvaluation();
    this.evaluationTimer = setInterval(
      () => this.runEvaluation(),
      this.config.evaluationIntervalMs,
    );
  }

  /** Stop the evaluation loop. */
  stop(): void {
    if (this.evaluationTimer) {
      clearInterval(this.evaluationTimer);
      this.evaluationTimer = null;
    }
  }

  /** Run a single evaluation cycle across all tracked projects. */
  async runEvaluation(): Promise<void> {
    if (!this.graphql || !this.stateService) return;

    let projects: Array<{ owner: string; repo: string }>;
    try {
      const config = await this.stateService.getConfig();
      projects = config.projects;
    } catch {
      return;
    }

    const newItems: AttentionItem[] = [];

    const results = await Promise.allSettled(
      projects.map((p) =>
        evaluateProjectAttention(
          this.graphql!,
          this.config.rules,
          p.owner,
          p.repo,
        ),
      ),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        for (const item of result.value) {
          // Preserve dismissed state from existing items
          const existing = this.items.get(item.id);
          if (existing) {
            item.dismissed = existing.dismissed;
            item.createdAt = existing.createdAt;
          }
          this.items.set(item.id, item);
          if (!existing) {
            newItems.push(item);
          }
        }
      }
    }

    // Evict old items if over capacity
    this.enforceMaxItems();

    // Broadcast new items to WebSocket subscribers
    if (newItems.length > 0 && this.broadcastFn) {
      this.broadcastFn(newItems);
    }
  }

  /** Get all items, optionally filtered. */
  list(query: AttentionQuery = {}): AttentionItem[] {
    let items = Array.from(this.items.values());

    if (query.severity) {
      items = items.filter((i) => i.severity === query.severity);
    }
    if (query.project) {
      items = items.filter((i) => i.project === query.project);
    }
    if (query.type) {
      items = items.filter((i) => i.type === query.type);
    }
    if (query.dismissed !== undefined) {
      items = items.filter((i) => i.dismissed === query.dismissed);
    }

    // Sort by severity (critical first), then by creation date (newest first)
    const severityOrder: Record<string, number> = {
      critical: 0,
      warning: 1,
      info: 2,
    };
    items.sort((a, b) => {
      const sDiff =
        (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3);
      if (sDiff !== 0) return sDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return items;
  }

  /** Dismiss (mark as read) an attention item. */
  dismiss(id: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    item.dismissed = true;
    return true;
  }

  /** Count of undismissed items. */
  unreadCount(): number {
    let count = 0;
    for (const item of this.items.values()) {
      if (!item.dismissed) count++;
    }
    return count;
  }

  /** Count of undismissed items by severity. */
  unreadCountBySeverity(): Record<string, number> {
    const counts: Record<string, number> = {
      critical: 0,
      warning: 0,
      info: 0,
    };
    for (const item of this.items.values()) {
      if (!item.dismissed) {
        counts[item.severity] = (counts[item.severity] ?? 0) + 1;
      }
    }
    return counts;
  }

  /** Get a single item by ID. */
  get(id: string): AttentionItem | undefined {
    return this.items.get(id);
  }

  /** Clear all items (useful for testing). */
  clear(): void {
    this.items.clear();
  }

  /** Manually add an item (for testing or external injection). */
  addItem(item: AttentionItem): void {
    this.items.set(item.id, item);
    this.enforceMaxItems();
  }

  private enforceMaxItems(): void {
    if (this.items.size <= this.config.maxItems) return;

    // Remove oldest dismissed items first, then oldest undismissed
    const sorted = Array.from(this.items.values()).sort((a, b) => {
      if (a.dismissed !== b.dismissed) return a.dismissed ? -1 : 1;
      return (
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    });

    while (this.items.size > this.config.maxItems && sorted.length > 0) {
      const toRemove = sorted.shift()!;
      this.items.delete(toRemove.id);
    }
  }
}
