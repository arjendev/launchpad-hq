import "@mantine/core/styles.css";
import "./styles/theme.css";

import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { ProjectProvider } from "./contexts/ProjectContext";
import { WebSocketProvider } from "./contexts/WebSocketContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { router } from "./router";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MantineProvider defaultColorScheme="auto">
        <ThemeProvider>
          <WebSocketProvider>
            <ProjectProvider>
              <RouterProvider router={router} />
            </ProjectProvider>
          </WebSocketProvider>
        </ThemeProvider>
      </MantineProvider>
    </QueryClientProvider>
  );
}
