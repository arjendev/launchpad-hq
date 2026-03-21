/**
 * Onboarding wizard steps.
 * Steps #41-#44 are fully implemented.
 */

import * as p from "@clack/prompts";
import type { LaunchpadConfig, WizardStep } from "./types.js";
import type { DevtunnelOps } from "./devtunnel-ops.js";
import { createDevtunnelOps } from "./devtunnel-ops.js";

// ── Curated model list (easy to update in one place) ────────────────────────

export const AVAILABLE_MODELS = [
  { value: "claude-opus-4.6", label: "Claude Opus 4.6", hint: "recommended — best for complex tasks" },
  { value: "claude-sonnet-4.6", label: "Claude Sonnet 4.6", hint: "faster, good balance" },
  { value: "claude-sonnet-4", label: "Claude Sonnet 4", hint: "cost-effective, capable" },
  { value: "gpt-5.2", label: "GPT-5.2", hint: "OpenAI, latest" },
  { value: "gpt-5.1", label: "GPT-5.1", hint: "OpenAI, good general purpose" },
  { value: "gemini-3-pro-preview", label: "Gemini 3 Pro", hint: "Google, preview" },
] as const;

// ── Step 1: State storage mode (#41) ────────────────────────────────────────

export const stateModeStep: WizardStep = {
  id: "state-mode",
  title: "State Storage Mode",

  async prompt(currentConfig: LaunchpadConfig) {
    p.note(
      [
        "Launchpad stores your project configuration, preferences, and enrichment data.",
        "You can choose where this data lives:",
        "",
        "🖥️  Local — Stored on this machine only (~/.launchpad/)",
        "   • Fast, no network needed, fully private",
        "   • Only available on this machine",
        "",
        "☁️  Git — Stored in a private GitHub repo (launchpad-state)",
        "   • Synced across all your machines",
        "   • Requires GitHub token with repo scope",
      ].join("\n"),
      "📦 State Storage",
    );

    const mode = await p.select({
      message: "How would you like to store your state?",
      options: [
        { value: "local", label: "Local", hint: "this machine only — fast & private" },
        { value: "git", label: "Git", hint: "private GitHub repo — synced everywhere" },
      ],
      initialValue: currentConfig.stateMode,
    });

    if (p.isCancel(mode)) {
      return { mode: "local" };
    }

    if (mode === "git") {
      const stateRepo = await p.text({
        message: "Which GitHub repo should store your state? (owner/repo)",
        placeholder: "your-username/launchpad-state",
        defaultValue: currentConfig.stateRepo,
        validate: (val) => {
          if (!val || !val.includes("/")) {
            return "Please enter a valid owner/repo (e.g. your-username/launchpad-state)";
          }
          return undefined;
        },
      });

      if (p.isCancel(stateRepo)) {
        return { mode: "local" };
      }

      return { mode, stateRepo };
    }

    return { mode };
  },

  validate(values) {
    const mode = values.mode as string | undefined;
    if (mode !== "local" && mode !== "git") {
      return "Please select either local or git mode.";
    }
    if (mode === "git") {
      const repo = values.stateRepo as string | undefined;
      if (!repo || !repo.includes("/")) {
        return "Please provide a valid GitHub repo (owner/repo) for git state storage.";
      }
    }
    return null;
  },

  apply(config, values) {
    return {
      ...config,
      stateMode: values.mode as "local" | "git",
      ...(values.stateRepo ? { stateRepo: values.stateRepo as string } : {}),
    };
  },
};

// ── Step 2: Copilot session preference (#42) ────────────────────────────────

export const copilotPrefStep: WizardStep = {
  id: "copilot-pref",
  title: "Copilot Session Preference",

  async prompt(currentConfig: LaunchpadConfig) {
    p.note(
      [
        "When you create a new Copilot session from the dashboard,",
        "which mode should be the default?",
        "",
        "🧠 SDK Mode — Better integration with HQ",
        "   • Structured conversations, tool use, plan mode",
        "   • Session introspection and real-time activity streaming in the dashboard",
        "",
        "💻 CLI Mode — Standalone terminal experience",
        "   • Classic copilot-in-the-terminal",
        "   • Familiar for devs who prefer raw CLI interaction",
        "",
        "You can always create either type of session later — this just sets the default.",
      ].join("\n"),
      "🤖 Copilot Session Mode",
    );

    const sessionType = await p.select({
      message: "Default Copilot session mode:",
      options: [
        { value: "sdk", label: "SDK Mode", hint: "structured conversations, tool use, plan mode, session introspection" },
        { value: "cli", label: "CLI Mode", hint: "standalone terminal, classic copilot experience" },
      ],
      initialValue: currentConfig.copilot.defaultSessionType,
    });

    return { sessionType };
  },

  validate(values) {
    const t = values.sessionType as string | undefined;
    if (t !== "sdk" && t !== "cli") {
      return "Please select either SDK or CLI mode.";
    }
    return null;
  },

  apply(config, values) {
    return {
      ...config,
      copilot: {
        ...config.copilot,
        defaultSessionType: values.sessionType as "sdk" | "cli",
      },
    };
  },
};

// ── Step 3: Default Copilot model (#43) ─────────────────────────────────────

export const modelStep: WizardStep = {
  id: "model",
  title: "Default AI Model",

  async prompt(currentConfig: LaunchpadConfig) {
    p.note(
      [
        "Which AI model should SDK sessions use by default?",
        "",
        "Tip: You can change the model per-session from the dashboard.",
      ].join("\n"),
      "🎯 Default Copilot Model",
    );

    const model = await p.select({
      message: "Default model:",
      options: AVAILABLE_MODELS.map((m) => ({
        value: m.value,
        label: m.label,
        hint: m.hint,
      })),
      initialValue: currentConfig.copilot.defaultModel as typeof AVAILABLE_MODELS[number]["value"],
    });

    return { model };
  },

  validate(values) {
    const model = values.model as string | undefined;
    if (!model || !AVAILABLE_MODELS.some((m) => m.value === model)) {
      return "Please select a model from the list.";
    }
    return null;
  },

  apply(config, values) {
    return {
      ...config,
      copilot: {
        ...config.copilot,
        defaultModel: values.model as string,
      },
    };
  },
};

// ── Step 4: Dev Tunnel configuration (#44) ──────────────────────────────────

/**
 * Factory for the devtunnel wizard step — accepts optional DevtunnelOps
 * for dependency injection in tests.
 */
export function createDevtunnelStep(ops?: DevtunnelOps): WizardStep {
  const devtunnelOps = ops ?? createDevtunnelOps();

  /** Handle the "always" mode configuration sub-flow. */
  async function configureAlwaysMode(): Promise<Record<string, unknown>> {
    const s = p.spinner();

    // 1. Check CLI availability
    s.start("Checking devtunnel CLI…");
    const cliAvailable = await devtunnelOps.isCliInstalled();
    if (!cliAvailable) {
      s.stop("devtunnel CLI not found");
      p.log.warning("The devtunnel CLI is not installed.");
      p.log.info("Install it from: https://aka.ms/devtunnels/install");
      p.log.info("Falling back to on-demand mode.");
      return { mode: "on-demand", configured: false };
    }
    s.stop("devtunnel CLI found ✓");

    // 2. Check existing authentication
    s.start("Checking authentication…");
    const alreadyAuthed = await devtunnelOps.isAuthenticated();
    if (alreadyAuthed) {
      s.stop("Already authenticated ✓");
      p.log.info("DevTunnel will auto-start on every HQ launch.");
      return { mode: "always", configured: true };
    }
    s.stop("Not yet authenticated");

    // 3. Offer to authenticate now
    const configureNow = await p.confirm({
      message: "Would you like to configure DevTunnel authentication now?",
      initialValue: true,
    });

    if (p.isCancel(configureNow) || !configureNow) {
      p.log.info("No problem! Mode set to on-demand.");
      p.log.info("To configure later, run: devtunnel user login");
      p.log.info("Then restart HQ with: npx launchpad-hq --tunnel");
      return { mode: "on-demand", configured: false };
    }

    // 4. Guide user through auth
    p.note(
      [
        "You need to log in with your Entra ID (Microsoft) account.",
        "",
        "Run this command in another terminal:",
        "",
        "  devtunnel user login",
        "",
        "Complete the login in your browser, then come back here.",
      ].join("\n"),
      "🔑 Authentication Required",
    );

    // 5. Poll for authentication
    s.start("Waiting for authentication… (up to 2 minutes)");
    const authSuccess = await devtunnelOps.waitForAuth();
    if (authSuccess) {
      s.stop("Authenticated ✓");
      p.log.info("DevTunnel will auto-start on every HQ launch.");
      return { mode: "always", configured: true };
    }

    s.stop("Authentication not detected within timeout");
    p.log.info("No worries! Mode set to on-demand.");
    p.log.info("To configure later, run: devtunnel user login");
    p.log.info("Then restart HQ with: npx launchpad-hq --tunnel");
    return { mode: "on-demand", configured: false };
  }

  return {
    id: "devtunnel",
    title: "Dev Tunnel Configuration",

    async prompt(currentConfig: LaunchpadConfig) {
      p.note(
        [
          "DevTunnels let you access your HQ dashboard from your phone or any",
          "browser, even outside your local network. This uses Microsoft",
          "DevTunnels with Entra ID (Azure AD) authentication for secure access.",
          "",
          "🔒 You'll need a Microsoft Entra ID account to use DevTunnels.",
        ].join("\n"),
        "🌐 Remote Access (DevTunnels)",
      );

      const mode = await p.select({
        message: "How should DevTunnels work?",
        options: [
          { value: "on-demand", label: "On-demand", hint: "start tunnels manually when you need them" },
          { value: "always", label: "Always", hint: "auto-start a tunnel every time HQ launches" },
        ],
        initialValue: currentConfig.tunnel.mode,
      });

      if (p.isCancel(mode)) {
        return { mode: "on-demand", configured: false };
      }

      if (mode === "on-demand") {
        return { mode: "on-demand", configured: false };
      }

      // "always" selected — attempt configuration
      try {
        return await configureAlwaysMode();
      } catch {
        // Never crash — graceful fallback (#45 principle)
        p.log.warning("Something went wrong during tunnel configuration.");
        p.log.info("Mode set to on-demand. Configure later with: devtunnel user login");
        return { mode: "on-demand", configured: false };
      }
    },

    validate(values) {
      const mode = values.mode as string | undefined;
      if (mode !== "always" && mode !== "on-demand") {
        return "Invalid tunnel mode.";
      }
      if (typeof values.configured !== "boolean") {
        return "Missing configuration status.";
      }
      return null;
    },

    apply(config, values) {
      return {
        ...config,
        tunnel: {
          mode: values.mode as "always" | "on-demand",
          configured: values.configured as boolean,
        },
      };
    },
  };
}

export const devtunnelStep = createDevtunnelStep();

// ── Step 5: Observability / OTEL (optional) (#59) ───────────────────────────

export const otelStep: WizardStep = {
  id: "otel",
  title: "Observability (Optional)",

  async prompt(_currentConfig: LaunchpadConfig) {
    p.note(
      [
        "OpenTelemetry gives you end-to-end tracing for Copilot sessions,",
        "API requests, and background tasks.",
        "",
        "📊 Jaeger — local collector + trace viewer (Docker)",
        "   • Endpoint: http://localhost:4317 (gRPC)",
        "   • UI: http://localhost:16686",
        "   • Start with: docker compose up -d",
        "",
        "🔗 Custom Endpoint — send traces to your own OTLP collector",
        "",
        "This is completely optional. You can enable it later in Settings.",
      ].join("\n"),
      "🔭 Observability",
    );

    const choice = await p.select({
      message: "How would you like to set up tracing?",
      options: [
        {
          value: "jaeger",
          label: "Enable with Jaeger (Docker)",
          hint: "recommended — run docker compose up -d first",
        },
        {
          value: "custom",
          label: "Enable with custom endpoint",
          hint: "bring your own collector",
        },
        {
          value: "skip",
          label: "Skip",
          hint: "leave observability disabled for now",
        },
      ],
      initialValue: "skip" as string,
    });

    if (p.isCancel(choice) || choice === "skip") {
      return { otelChoice: "skip" };
    }

    if (choice === "jaeger") {
      return {
        otelChoice: "jaeger",
        enabled: true,
        endpoint: "http://localhost:4317",
      };
    }

    // Custom endpoint
    const endpoint = await p.text({
      message: "OTLP gRPC endpoint:",
      placeholder: "http://localhost:4317",
      defaultValue: "http://localhost:4317",
      validate: (val) => {
        if (!val) return "Please enter an endpoint URL";
        try {
          new URL(val);
        } catch {
          return "Please enter a valid URL (e.g. http://localhost:4317)";
        }
        return undefined;
      },
    });

    if (p.isCancel(endpoint)) {
      return { otelChoice: "skip" };
    }

    return {
      otelChoice: "custom",
      enabled: true,
      endpoint: endpoint as string,
    };
  },

  validate(values) {
    const choice = values.otelChoice as string | undefined;
    if (choice !== "skip" && choice !== "jaeger" && choice !== "custom") {
      return "Invalid observability choice.";
    }
    if (choice !== "skip" && !values.endpoint) {
      return "Endpoint is required when OTEL is enabled.";
    }
    return null;
  },

  apply(config, values) {
    if (values.otelChoice === "skip") {
      return config;
    }
    return {
      ...config,
      otel: {
        enabled: true,
        endpoint: values.endpoint as string,
      },
    };
  },
};

export const defaultSteps: WizardStep[] = [
  stateModeStep,
  copilotPrefStep,
  modelStep,
  devtunnelStep,
  otelStep,
];
