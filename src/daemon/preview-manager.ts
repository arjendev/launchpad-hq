/**
 * PreviewManager — owns the preview proxy lifecycle.
 *
 * Handles auto-detection of preview ports (with retry), creation of
 * PreviewProxyHandler, and cleanup on shutdown.
 */

import type { DaemonInfo } from '../shared/protocol.js';
import type { DaemonWebSocketClient } from './client.js';
import { PreviewProxyHandler } from './preview.js';
import { detectPreviewPort } from './preview-detect.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PreviewManagerOptions {
  client: DaemonWebSocketClient;
  projectId: string;
  projectPath: string;
  /** Explicit preview port from config (skips auto-detection) */
  previewPort?: number;
  /** DaemonInfo to add 'preview' capability to */
  daemonInfo: DaemonInfo;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max retries for periodic re-detection (15 s × 20 = 5 min) */
const PREVIEW_RETRY_INTERVAL_MS = 15_000;
const PREVIEW_MAX_RETRIES = 20;

// ---------------------------------------------------------------------------
// PreviewManager
// ---------------------------------------------------------------------------

export class PreviewManager {
  private client: DaemonWebSocketClient;
  private projectId: string;
  private projectPath: string;
  private explicitPort?: number;
  private daemonInfo: DaemonInfo;

  private handler: PreviewProxyHandler | null = null;
  private detectTimer: ReturnType<typeof setInterval> | null = null;
  private retryCount = 0;

  constructor(options: PreviewManagerOptions) {
    this.client = options.client;
    this.projectId = options.projectId;
    this.projectPath = options.projectPath;
    this.explicitPort = options.previewPort;
    this.daemonInfo = options.daemonInfo;
  }

  /** The current handler (null if preview not active) */
  get previewHandler(): PreviewProxyHandler | null {
    return this.handler;
  }

  /** Handle an incoming HQ preview-* message */
  handleMessage(msg: { type: string }): void {
    if (this.handler) {
      this.handler.handleMessage(msg);
    }
  }

  /**
   * Start preview detection/setup.
   * Called when the daemon authenticates with HQ.
   */
  start(): void {
    if (this.explicitPort) {
      console.log(`🔍 Preview detect: explicit previewPort=${this.explicitPort} configured, skipping auto-detection`);
      this.startPreview(this.explicitPort, false, 'config');
      this.handler!.sendConfig();
    } else {
      console.log(`🔍 Preview detect: no explicit previewPort, attempting auto-detection for projectPath=${this.projectPath}`);
      this.retryCount = 0;
      void this.detectAndStartPreview();
      this.detectTimer = setInterval(() => {
        if (this.handler) {
          this.stopRetry();
          return;
        }
        this.retryCount++;
        if (this.retryCount > PREVIEW_MAX_RETRIES) {
          console.log(`🔍 Preview detect: gave up after ${PREVIEW_MAX_RETRIES} retries`);
          this.stopRetry();
          return;
        }
        console.log(`🔍 Preview detect: retry ${this.retryCount}/${PREVIEW_MAX_RETRIES}, scanning...`);
        void this.detectAndStartPreview();
      }, PREVIEW_RETRY_INTERVAL_MS);
    }
  }

  /** Stop the preview manager and clean up resources */
  stop(): void {
    this.stopRetry();
    if (this.handler) {
      this.handler.cleanup();
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private startPreview(
    port: number,
    autoDetected: boolean,
    detectedFrom?: 'config' | 'devcontainer' | 'port-scan' | 'package-json',
  ): void {
    if (this.handler) return; // Already running
    this.handler = new PreviewProxyHandler({
      client: this.client,
      projectId: this.projectId,
      previewPort: port,
      autoDetected,
      detectedFrom,
    });
    if (!this.daemonInfo.capabilities.includes('preview')) {
      this.daemonInfo.capabilities.push('preview');
    }
    console.log(`🖼 Preview proxy enabled on port ${port} (${detectedFrom ?? 'config'})`);
  }

  private stopRetry(): void {
    if (this.detectTimer) {
      clearInterval(this.detectTimer);
      this.detectTimer = null;
    }
  }

  private async detectAndStartPreview(): Promise<void> {
    try {
      const detected = await detectPreviewPort(this.projectPath);
      console.log(`🔍 Preview detect: detection result = ${detected ? `port ${detected.port} from ${detected.source}` : 'null'}`);
      if (detected && !this.handler) {
        this.startPreview(detected.port, true, detected.source);
        if (this.client.isAuthenticated) {
          this.handler!.sendConfig();
        }
        this.stopRetry();
      }
    } catch {
      // Silent — detection is best-effort
    }
  }
}
