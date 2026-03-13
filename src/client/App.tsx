import "@mantine/core/styles.css";

import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { ProjectProvider } from "./contexts/ProjectContext";
import { WebSocketProvider } from "./contexts/WebSocketContext";
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
        <WebSocketProvider>
          <ProjectProvider>
            <RouterProvider router={router} />
          </ProjectProvider>
        </WebSocketProvider>
      </MantineProvider>
    </QueryClientProvider>
  );
}
