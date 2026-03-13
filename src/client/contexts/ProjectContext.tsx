import { createContext, useContext, useState, useCallback } from "react";
import type { ReactNode } from "react";
import type { DashboardProject } from "../api/types.js";

interface ProjectContextValue {
  selectedProject: DashboardProject | null;
  selectProject: (project: DashboardProject | null) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [selectedProject, setSelectedProject] =
    useState<DashboardProject | null>(null);

  const selectProject = useCallback(
    (project: DashboardProject | null) => setSelectedProject(project),
    [],
  );

  return (
    <ProjectContext.Provider value={{ selectedProject, selectProject }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useSelectedProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useSelectedProject must be used within a ProjectProvider");
  }
  return ctx;
}
