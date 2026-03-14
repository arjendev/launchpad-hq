import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { AggregatedSession } from "../services/types.js";
import { useSelectedProject } from "./ProjectContext.js";
import { useDisconnectSession, useResumeSession } from "../services/hooks.js";

interface SessionContextValue {
  selectedSession: AggregatedSession | null;
  selectSession: (session: AggregatedSession | null) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [selectedSession, setSelectedSession] = useState<AggregatedSession | null>(null);
  const { selectedProject } = useSelectedProject();
  const disconnectSession = useDisconnectSession();
  const resumeSession = useResumeSession();

  // Track previous project to detect changes
  const prevProjectRef = useRef(selectedProject);

  // When selectedProject changes, detach current session and clear selection
  useEffect(() => {
    const prev = prevProjectRef.current;
    prevProjectRef.current = selectedProject;

    const changed =
      prev?.owner !== selectedProject?.owner ||
      prev?.repo !== selectedProject?.repo;

    if (changed && selectedSession) {
      disconnectSession.mutate(selectedSession.sessionId);
      setSelectedSession(null);
    }
  }, [selectedProject]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectSession = useCallback(
    (session: AggregatedSession | null) => {
      const current = selectedSession;

      // No-op if re-selecting the same session (avoids duplicate resume)
      if (session && current?.sessionId === session.sessionId) return;

      // Disconnect outgoing session (all types) to clean up daemon-side listeners
      if (current) {
        disconnectSession.mutate(current.sessionId);
      }

      setSelectedSession(session);

      // Resume the newly selected session
      if (session) {
        resumeSession.mutate({ sessionId: session.sessionId });
      }
    },
    [selectedSession, disconnectSession, resumeSession],
  );

  return (
    <SessionContext.Provider value={{ selectedSession, selectSession }}>
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
