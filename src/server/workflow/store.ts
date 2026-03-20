/**
 * Workflow State Store
 *
 * In-memory store for workflow issue state, per project.
 * Follows the existing state management pattern with periodic flush.
 */

import type { StateService } from "../state/types.js";
import type { WorkflowIssue, FeedbackEntry } from "./state-machine.js";
import type { CoordinatorProjectState, TrackedCommit } from "../../shared/protocol.js";
import { defaultCoordinatorState } from "./coordinator-state.js";
import { CommitTracker } from "./commit-tracker.js";

// --- Persisted shape ---

export interface WorkflowProjectState {
  owner: string;
  repo: string;
  issues: WorkflowIssue[];
  lastSyncAt: string | null;
  updatedAt: string;
  coordinator: CoordinatorProjectState;
  commits: TrackedCommit[];
}

export interface WorkflowData {
  version: 1;
  projects: Record<string, WorkflowProjectState>; // key = "owner/repo"
}

function defaultWorkflowData(): WorkflowData {
  return { version: 1, projects: {} };
}

function projectKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

// --- Store ---

export class WorkflowStore {
  private data: WorkflowData;
  private dirty = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  readonly commitTracker: CommitTracker;

  constructor(
    private readonly stateService: StateService | null,
    private readonly flushIntervalMs = 30_000,
  ) {
    this.data = defaultWorkflowData();
    this.commitTracker = new CommitTracker();

    if (this.stateService && this.flushIntervalMs > 0) {
      this.flushTimer = setInterval(() => {
        this.flush().catch((err) => {
          console.warn("Workflow store flush failed:", err);
        });
      }, this.flushIntervalMs);
    }
  }

  /** Get or create project state. */
  getProject(owner: string, repo: string): WorkflowProjectState {
    const key = projectKey(owner, repo);
    if (!this.data.projects[key]) {
      this.data.projects[key] = {
        owner,
        repo,
        issues: [],
        lastSyncAt: null,
        updatedAt: new Date().toISOString(),
        coordinator: defaultCoordinatorState(),
        commits: [],
      };
      this.dirty = true;
    }
    return this.data.projects[key];
  }

  /** Get all issues for a project. */
  getIssues(owner: string, repo: string): WorkflowIssue[] {
    return this.getProject(owner, repo).issues;
  }

  /** Get a single issue by number. */
  getIssue(owner: string, repo: string, number: number): WorkflowIssue | undefined {
    return this.getProject(owner, repo).issues.find((i) => i.number === number);
  }

  /** Replace the entire issue list for a project (after sync). */
  setIssues(owner: string, repo: string, issues: WorkflowIssue[]): void {
    const project = this.getProject(owner, repo);
    project.issues = issues;
    project.lastSyncAt = new Date().toISOString();
    project.updatedAt = new Date().toISOString();
    this.dirty = true;
  }

  /** Update a single issue in place. */
  updateIssue(owner: string, repo: string, issue: WorkflowIssue): void {
    const project = this.getProject(owner, repo);
    const idx = project.issues.findIndex((i) => i.number === issue.number);
    if (idx >= 0) {
      project.issues[idx] = issue;
    } else {
      project.issues.push(issue);
    }
    project.updatedAt = new Date().toISOString();
    this.dirty = true;
  }

  /** Add feedback to an issue. */
  addFeedback(owner: string, repo: string, issueNumber: number, feedback: FeedbackEntry): WorkflowIssue | undefined {
    const issue = this.getIssue(owner, repo, issueNumber);
    if (!issue) return undefined;

    issue.feedback.push(feedback);
    issue.updatedAt = new Date().toISOString();
    this.dirty = true;
    return issue;
  }

  // --- Coordinator state ---

  /** Get coordinator state for a project. */
  getCoordinator(owner: string, repo: string): CoordinatorProjectState {
    return this.getProject(owner, repo).coordinator;
  }

  /** Update coordinator state for a project. */
  setCoordinator(owner: string, repo: string, coordinator: CoordinatorProjectState): void {
    const project = this.getProject(owner, repo);
    project.coordinator = coordinator;
    project.updatedAt = new Date().toISOString();
    this.dirty = true;
  }

  /** Flush pending changes to the state service. */
  async flush(): Promise<void> {
    if (!this.dirty || !this.stateService) return;
    try {
      const enrichment = await this.stateService.getEnrichment();
      // Store workflow data in the enrichment's projects metadata
      // This piggybacks on the existing state persistence without adding a new file
      for (const [key, project] of Object.entries(this.data.projects)) {
        if (!enrichment.projects[key]) {
          const [owner, repo] = key.split("/");
          enrichment.projects[key] = { owner, repo };
        }
        (enrichment.projects[key] as unknown as Record<string, unknown>).workflowState = {
          issues: project.issues,
          lastSyncAt: project.lastSyncAt,
          coordinator: project.coordinator,
          commits: this.commitTracker.toJSON(project.owner, project.repo),
        };
      }
      enrichment.updatedAt = new Date().toISOString();
      await this.stateService.saveEnrichment(enrichment);
      this.dirty = false;
    } catch (err) {
      console.warn("Workflow store flush failed:", err);
    }
  }

  /** Load persisted state from the state service. */
  async load(): Promise<void> {
    if (!this.stateService) return;
    try {
      const enrichment = await this.stateService.getEnrichment();
      for (const [key, entry] of Object.entries(enrichment.projects)) {
        const workflowData = (entry as unknown as Record<string, unknown>).workflowState as
          | {
              issues: WorkflowIssue[];
              lastSyncAt: string | null;
              coordinator?: CoordinatorProjectState;
              commits?: TrackedCommit[];
            }
          | undefined;
        if (workflowData) {
          const [owner, repo] = key.split("/");
          this.data.projects[key] = {
            owner,
            repo,
            issues: workflowData.issues ?? [],
            lastSyncAt: workflowData.lastSyncAt ?? null,
            updatedAt: new Date().toISOString(),
            coordinator: {
              ...(workflowData.coordinator ?? defaultCoordinatorState()),
              // Reset status to idle on load — daemon isn't connected yet
              // but preserve sessionId for resume
              status: "idle",
              error: null,
            },
            commits: workflowData.commits ?? [],
          };
          // Restore commit tracker index
          if (workflowData.commits?.length) {
            this.commitTracker.loadCommits(owner, repo, workflowData.commits);
          }
        }
      }
    } catch {
      // First run or no persisted data — start fresh
    }
  }

  /** Shut down the store (stop timer, flush). */
  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  /** Snapshot for testing. */
  getData(): WorkflowData {
    return this.data;
  }
}
