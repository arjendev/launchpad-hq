/**
 * Full-screen modal overlay that wraps the Terminal component.
 * Uses Mantine Modal for consistent UI chrome.
 */

import { Modal } from "@mantine/core";
import { Terminal } from "./Terminal.js";

export interface TerminalOverlayProps {
  /** Daemon whose terminal to open. */
  daemonId: string;
  /** Whether the overlay is visible. */
  isOpen: boolean;
  /** Called when the user closes the overlay. */
  onClose: () => void;
}

export function TerminalOverlay({ daemonId, isOpen, onClose }: TerminalOverlayProps) {
  return (
    <Modal
      opened={isOpen}
      onClose={onClose}
      title="Terminal"
      fullScreen
      // Keep terminal alive when closed so it can be re-opened
      keepMounted={false}
      styles={{
        content: {
          display: "flex",
          flexDirection: "column",
          backgroundColor: "var(--lp-bg)",
        },
        header: {
          backgroundColor: "var(--lp-surface)",
          borderBottom: "1px solid var(--lp-border)",
          color: "var(--lp-text)",
          padding: "8px 16px",
          minHeight: "auto",
        },
        title: {
          fontWeight: 600,
          fontSize: 14,
        },
        body: {
          flex: 1,
          padding: 0,
          overflow: "hidden",
        },
      }}
      data-testid="terminal-overlay"
    >
      <div style={{ width: "100%", height: "100%", minHeight: 0 }}>
        <Terminal daemonId={daemonId} onClose={onClose} />
      </div>
    </Modal>
  );
}
