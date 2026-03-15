---
layout: home

hero:
  name: Launchpad HQ
  text: HQ for your AI-powered dev fleet.
  tagline: "Track all your projects, every Copilot session, every tool call — from one dashboard. Today it's about productivity and visibility. Soon, every agent gets your context, your tools, your MCP servers — automatically."
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/arjendev/launchpad-hq

features:
  - icon: 🎯
    title: Multi-Project Dashboard
    details: All your repos in one three-pane mission control. Issues, PRs, sessions at a glance. Badge counts tell you where to focus.
  - icon: 🤖
    title: Live Copilot Introspection
    details: See what every agent is doing in real-time. Read conversations, watch tool calls, inject prompts, or take the wheel entirely.
  - icon: 🏗️
    title: Daemon Architecture
    details: One HQ, one daemon per project. Daemons live inside your devcontainers and push state to HQ over WebSocket. Zero polling, full isolation.
  - icon: 📱
    title: Remote Access via Dev Tunnels
    details: Open your dashboard from your phone or tablet. QR code scan, instant access. Check on your fleet from the bus.
---

<style>
:root {
  --vp-home-hero-name-color: transparent;
  --vp-home-hero-name-background: -webkit-linear-gradient(120deg, #bd34fe 30%, #41d1ff);
}
</style>

## What's Coming Soon {#roadmap}

<div class="vp-doc" style="padding: 0 24px;">

🔌 **MCP Server Injection** — Configure tools in HQ, every agent across every project gets them automatically. One config, fleet-wide tooling.

📊 **Token Usage & Observability** — Know where your AI spend goes. Track token usage per session, per project, per model.

🖼️ **App Preview Proxy** — See your running apps from the dashboard. Live previews of what your agents are building.

</div>

## Quick Start {#quick-start}

<div class="vp-doc" style="padding: 0 24px;">

**1. Install and launch**
```bash
npx github:arjendev/launchpad-hq
```

**2. Add a project**

Point HQ at any GitHub repo. It picks up issues, PRs, and spins up a daemon.

**3. Open the dashboard**

Three-pane mission control: projects → kanban → live sessions. Drill from overview to introspection.

</div>
