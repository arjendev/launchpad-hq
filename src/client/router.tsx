import {
  createRouter,
  createRootRoute,
  createRoute,
  Outlet,
} from "@tanstack/react-router";
import { DashboardLayout } from "./layouts/DashboardLayout";
import { SettingsPage } from "./pages/SettingsPage";
import { OnboardingPage } from "./pages/OnboardingPage";

export function detectRouterBasepath(pathname: string): string | undefined {
  const match = pathname.match(/^\/preview\/([^/]+)(?:\/|$)/);
  if (!match) return undefined;

  return `/preview/${match[1]}`;
}

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardLayout,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding",
  component: OnboardingPage,
});

const routeTree = rootRoute.addChildren([indexRoute, settingsRoute, onboardingRoute]);

const basepath =
  typeof window === "undefined"
    ? undefined
    : detectRouterBasepath(window.location.pathname);

export const router = createRouter({
  routeTree,
  ...(basepath ? { basepath } : {}),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
