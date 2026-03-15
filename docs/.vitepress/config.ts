import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Launchpad HQ',
  description: 'Command and control center for managing multiple projects',
  base: '/launchpad-hq/',
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Features', link: '/features/projects' },
      { text: 'Daemon', link: '/daemon/setup' },
      { text: 'API', link: '/api/rest' },
    ],
    sidebar: {
      '/guide/': [
        { text: 'Getting Started', link: '/guide/getting-started' },
        { text: 'Onboarding', link: '/guide/onboarding' },
        { text: 'Architecture', link: '/guide/architecture' },
      ],
      '/features/': [
        { text: 'Projects', link: '/features/projects' },
        { text: 'Copilot Sessions', link: '/features/copilot' },
        { text: 'App Preview', link: '/features/preview' },
        { text: 'DevTunnels', link: '/features/devtunnels' },
        { text: 'Settings', link: '/features/settings' },
      ],
      '/daemon/': [
        { text: 'Setup', link: '/daemon/setup' },
        { text: 'Configuration', link: '/daemon/config' },
        { text: 'Protocol', link: '/daemon/protocol' },
      ],
      '/api/': [
        { text: 'REST API', link: '/api/rest' },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/arjendev/launchpad-hq' },
    ],
    search: { provider: 'local' },
    footer: { message: 'Built with VitePress' },
  },
})
