import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { AggregatedSession } from "../services/types.js";
import { useSelectedProject } from "./ProjectContext.js";
import { useDisconnectSession, useResumeSession } from "../services/hooks.js";

interface SessionContextValue {
  selectedSession: AggregatedSession | null;
  pendingSessionId: string | null;
  selectSession: (
    session: AggregatedSession | null,
    options?: { resume?: boolean },
  ) => void;
  terminalOpen: boolean;
  openTerminal: () => void;
  closeTerminal: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const SESSION_STORAGE_KEY = "lp-selected-session-id";

function shouldDisconnectOnDeselect(session: AggregatedSession | null): boolean {
  return session?.sessionType === "copilot-cli";
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [selectedSession, setSelectedSession] = useState<AggregatedSession | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [pendingSessionId] = useState<string | null>(() => {
    try { return sessionStorage.getItem(SESSION_STORAGE_KEY); } catch { return null; }
  });
  const { selectedProject } = useSelectedProject();
  const disconnectSession = useDisconnectSession();
  const resumeSession = useResumeSession();

  // Track previous project to detect changes
  const prevProjectRef = useRef(selectedProject);

  // When the project changes, only CLI sessions need an explicit detach.
  // SDK sessions should keep running in the background.
  useEffect(() => {
    const prev = prevProjectRef.current;
    prevProjectRef.current = selectedProject;

    const changed =
      prev?.owner !== selectedProject?.owner ||
      prev?.repo !== selectedProject?.repo;

    if (changed) {
      if (selectedSession && shouldDisconnectOnDeselect(selectedSession)) {
        disconnectSession.mutate(selectedSession.sessionId);
      }
      setSelectedSession(null);
      setTerminalOpen(false);
    }
  }, [selectedProject]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectSession = useCallback(
    (
      session: AggregatedSession | null,
      options?: { resume?: boolean },
    ) => {
      const current = selectedSession;

      // No-op if re-selecting the same session (avoids duplicate resume)
      if (session && current?.sessionId === session.sessionId) return;

      // Only CLI sessions need an explicit daemon-side detach when the UI switches away.
      if (current && shouldDisconnectOnDeselect(current)) {
        disconnectSession.mutate(current.sessionId);
      }

      setSelectedSession(session);
      // Persist to sessionStorage for restore after page refresh
      try {
        if (session) {
          sessionStorage.setItem(SESSION_STORAGE_KEY, session.sessionId);
        } else {
          sessionStorage.removeItem(SESSION_STORAGE_KEY);
        }
      } catch { /* storage unavailable */ }
      // Selecting a session closes the standalone terminal
      if (session) setTerminalOpen(false);

      // Resume existing sessions on selection. Freshly created sessions can opt out
      // because create already starts them, and StrictMode would otherwise amplify
      // duplicate resume calls during initial mount.
      if (session && options?.resume !== false) {
        resumeSession.mutate({ sessionId: session.sessionId });
      }
    },
    [selectedSession, disconnectSession, resumeSession],
  );

  const openTerminal = useCallback(() => {
    // Deselect current session and open standalone terminal
    if (selectedSession && shouldDisconnectOnDeselect(selectedSession)) {
      disconnectSession.mutate(selectedSession.sessionId);
    }
    setSelectedSession(null);
    setTerminalOpen(true);
  }, [selectedSession, disconnectSession]);

  const closeTerminal = useCallback(() => {
    setTerminalOpen(false);
  }, []);

  return (
    <SessionContext.Provider value={{ selectedSession, pendingSessionId, selectSession, terminalOpen, openTerminal, closeTerminal }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSelectedSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSelectedSession must be used within a SessionProvider");
  }
  return ctx;
}
