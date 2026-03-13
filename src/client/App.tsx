import "@mantine/core/styles.css";

import { MantineProvider } from "@mantine/core";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";

export function App() {
  return (
    <MantineProvider defaultColorScheme="auto">
      <RouterProvider router={router} />
    </MantineProvider>
  );
}
