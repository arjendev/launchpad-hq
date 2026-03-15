/**
 * Onboarding wizard steps.
 * Steps #41-#43 are fully implemented; #44 (devtunnel) remains a placeholder.
 */

import * as p from "@clack/prompts";
import type { LaunchpadConfig, WizardStep } from "./types.js";

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

  async prompt() {
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
      initialValue: "local",
    });

    return { mode };
  },

  validate(values) {
    const mode = values.mode as string | undefined;
    if (mode !== "local" && mode !== "git") {
      return "Please select either local or git mode.";
    }
    return null;
  },

  apply(config, values) {
    return {
      ...config,
      stateMode: values.mode as "local" | "git",
    };
  },
};

// ── Step 2: Copilot session preference (#42) ────────────────────────────────

export const copilotPrefStep: WizardStep = {
  id: "copilot-pref",
  title: "Copilot Session Preference",

  async prompt() {
    p.note(
      [
        "When you create a new Copilot session from the dashboard,",
        "which mode should be the default?",
        "",
        "🧠 SDK Mode — Rich agent experience",
        "   • Structured conversations with tool use",
        "   • Plan mode for complex multi-step tasks",
        "   • Autopilot for autonomous work",
        "   • Full session introspection in the dashboard",
        "",
        "💻 CLI Mode — Classic terminal experience",
        "   • Copilot running directly in your terminal",
        "   • Lightweight, familiar interface",
        "   • Great for quick questions and code edits",
        "",
        "You can always create either type — this just sets the default.",
      ].join("\n"),
      "🤖 Copilot Session Mode",
    );

    const sessionType = await p.select({
      message: "Default Copilot session mode:",
      options: [
        { value: "sdk", label: "SDK Mode", hint: "rich agent experience" },
        { value: "cli", label: "CLI Mode", hint: "classic terminal" },
      ],
      initialValue: "sdk",
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

  async prompt() {
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
      initialValue: "claude-opus-4.6",
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

// ── Step 4: Dev Tunnel — placeholder (#44) ──────────────────────────────────

function placeholderStep(id: string, title: string): WizardStep {
  return {
    id,
    title,
    async prompt() {
      return {};
    },
    validate() {
      return null;
    },
    apply(config: LaunchpadConfig) {
      return config;
    },
  };
}

export const devtunnelStep = placeholderStep("devtunnel", "Dev Tunnel Configuration");

export const defaultSteps: WizardStep[] = [
  stateModeStep,
  copilotPrefStep,
  modelStep,
  devtunnelStep,
];
