import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_COPILOT_AGENT_ID,
  discoverCopilotAgents,
} from '../agent-catalog.js';

describe('discoverCopilotAgents', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('always includes the default plain session option', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'launchpad-agents-'));
    tempDirs.push(cwd);

    const discovered = discoverCopilotAgents(cwd);

    expect(discovered.catalog).toHaveLength(1);
    expect(discovered.catalog[0].id).toBe(DEFAULT_COPILOT_AGENT_ID);
    expect(discovered.catalog[0].kind).toBe('default');
    expect(discovered.customAgents).toHaveLength(0);
  });

  it('parses .github/agents/*.agent.md into catalog entries and runtime definitions', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'launchpad-agents-'));
    tempDirs.push(cwd);

    const agentsDir = join(cwd, '.github', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      join(agentsDir, 'squad.agent.md'),
      `---
name: Squad
description: "Coordinates specialists for the project"
tools:
  - read
  - edit
model: gpt-5.4
user-invocable: false
target: vscode
disable-model-invocation: true
---
# Squad

Coordinate specialists and synthesize their work.
`,
      'utf8',
    );

    const discovered = discoverCopilotAgents(cwd);
    const customEntry = discovered.catalog.find((entry) => entry.id === 'github:squad');

    expect(discovered.catalog).toHaveLength(2);
    expect(customEntry).toBeDefined();
    expect(customEntry).toMatchObject({
      id: 'github:squad',
      name: 'squad',
      displayName: 'Squad',
      description: 'Coordinates specialists for the project',
      source: 'github-agent-file',
      kind: 'custom',
      path: '.github/agents/squad.agent.md',
      model: 'gpt-5.4',
      tools: ['read', 'edit'],
      userInvocable: false,
      target: 'vscode',
    });

    expect(discovered.customAgents).toHaveLength(1);
    expect(discovered.customAgents[0]).toMatchObject({
      name: 'squad',
      displayName: 'Squad',
      description: 'Coordinates specialists for the project',
      tools: ['read', 'edit'],
      infer: false,
    });
    expect(discovered.customAgents[0].prompt).toContain('Coordinate specialists');
  });
});
