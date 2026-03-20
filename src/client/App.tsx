import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./styles/theme.css";

import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { ProjectProvider } from "./contexts/ProjectContext";
import { SessionProvider } from "./contexts/SessionContext";
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
      <MantineProvider defaultColorScheme="dark">
        <Notifications position="top-right" />
        <ThemeProvider>
          <WebSocketProvider>
            <ProjectProvider>
              <SessionProvider>
                <RouterProvider router={router} />
              </SessionProvider>
            </ProjectProvider>
          </WebSocketProvider>
        </ThemeProvider>
      </MantineProvider>
    </QueryClientProvider>
  );
}
