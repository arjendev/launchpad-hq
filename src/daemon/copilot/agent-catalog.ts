import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import type { CustomAgentConfig } from '@github/copilot-sdk';
import type { CopilotAgentCatalogEntry } from '../../shared/protocol.js';

type ParsedFrontmatterValue = boolean | string | string[];

interface ParsedAgentFrontmatter {
  name?: string;
  description?: string;
  tools?: string[];
  model?: string;
  target?: string;
  userInvocable?: boolean;
  infer?: boolean;
}

export interface DiscoveredCopilotAgents {
  catalog: CopilotAgentCatalogEntry[];
  customAgents: CustomAgentConfig[];
}

export const DEFAULT_COPILOT_AGENT_ID = 'builtin:default';

export function createDefaultCopilotAgentCatalogEntry(): CopilotAgentCatalogEntry {
  return {
    id: DEFAULT_COPILOT_AGENT_ID,
    name: 'default',
    displayName: 'Plain session',
    description: 'Standard Copilot session without a custom agent persona.',
    kind: 'default',
    source: 'builtin',
    userInvocable: true,
  };
}

export function discoverCopilotAgents(cwd = process.cwd()): DiscoveredCopilotAgents {
  const catalog: CopilotAgentCatalogEntry[] = [createDefaultCopilotAgentCatalogEntry()];
  const customAgents: CustomAgentConfig[] = [];
  const seenIds = new Set<string>([DEFAULT_COPILOT_AGENT_ID]);

  for (const filePath of listAgentFiles(cwd)) {
    try {
      const { catalogEntry, customAgent } = parseAgentFile(filePath, cwd);
      if (seenIds.has(catalogEntry.id)) {
        console.warn(`⚠ Skipping duplicate Copilot agent definition: ${catalogEntry.id}`);
        continue;
      }
      seenIds.add(catalogEntry.id);
      catalog.push(catalogEntry);
      customAgents.push(customAgent);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`⚠ Failed to load Copilot agent from ${filePath}: ${message}`);
    }
  }

  return { catalog, customAgents };
}

function listAgentFiles(cwd: string): string[] {
  const agentsDir = join(cwd, '.github', 'agents');
  if (!existsSync(agentsDir)) return [];

  return readdirSync(agentsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.agent.md'))
    .map((entry) => join(agentsDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function parseAgentFile(
  filePath: string,
  cwd: string,
): { catalogEntry: CopilotAgentCatalogEntry; customAgent: CustomAgentConfig } {
  const raw = readFileSync(filePath, 'utf8');
  const { frontmatter, body } = splitFrontmatter(raw);
  const metadata = parseFrontmatter(frontmatter);
  const slug = basename(filePath, '.agent.md');
  const displayName = metadata.name?.trim() || undefined;
  const description =
    metadata.description?.trim() ||
    summarizePrompt(body) ||
    `${displayName ?? slug} custom agent`;
  const prompt = body.trim() || description;

  const catalogEntry: CopilotAgentCatalogEntry = {
    id: `github:${slug}`,
    name: slug,
    ...(displayName && displayName !== slug ? { displayName } : {}),
    description,
    kind: 'custom',
    source: 'github-agent-file',
    path: normalizeRelativePath(relative(cwd, filePath)),
    ...(metadata.model ? { model: metadata.model } : {}),
    ...(metadata.tools?.length ? { tools: metadata.tools } : {}),
    ...(metadata.target ? { target: metadata.target } : {}),
    ...(metadata.userInvocable !== undefined ? { userInvocable: metadata.userInvocable } : {}),
  };

  const customAgent: CustomAgentConfig = {
    name: slug,
    ...(displayName ? { displayName } : {}),
    description,
    prompt,
    ...(metadata.tools?.length ? { tools: metadata.tools } : {}),
    ...(metadata.infer !== undefined ? { infer: metadata.infer } : {}),
  };

  return { catalogEntry, customAgent };
}

function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: '', body: raw };
  }

  return {
    frontmatter: match[1],
    body: match[2],
  };
}

function parseFrontmatter(frontmatter: string): ParsedAgentFrontmatter {
  if (!frontmatter.trim()) return {};

  const values = new Map<string, ParsedFrontmatterValue>();
  const lines = frontmatter.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(trimmed);
    if (!match) continue;

    const key = match[1].toLowerCase();
    const rawValue = match[2] ?? '';

    if (!rawValue) {
      const listItems: string[] = [];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const next = lines[cursor];
        if (!next.trim()) {
          cursor += 1;
          continue;
        }
        if (/^\s*-\s+/.test(next)) {
          listItems.push(stripQuotes(next.replace(/^\s*-\s+/, '').trim()));
          cursor += 1;
          continue;
        }
        if (/^\s+/.test(next)) {
          cursor += 1;
          continue;
        }
        break;
      }

      if (listItems.length > 0) {
        values.set(key, listItems);
        index = cursor - 1;
      }
      continue;
    }

    values.set(key, parseScalarValue(rawValue));
  }

  const infer =
    getBoolean(values, 'infer') ??
    invertBoolean(getBoolean(values, 'disable-model-invocation')) ??
    invertBoolean(getBoolean(values, 'disable_model_invocation'));

  return {
    name:
      getString(values, 'display-name') ??
      getString(values, 'display_name') ??
      getString(values, 'name'),
    description: getString(values, 'description'),
    tools: getStringArray(values, 'tools'),
    model: getString(values, 'model'),
    target: getString(values, 'target'),
    userInvocable:
      getBoolean(values, 'user-invocable') ?? getBoolean(values, 'user_invocable'),
    ...(infer !== undefined ? { infer } : {}),
  };
}

function parseScalarValue(rawValue: string): ParsedFrontmatterValue {
  const value = rawValue.trim();

  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((entry) => stripQuotes(entry.trim()))
      .filter(Boolean);
  }

  if (/^(true|false)$/i.test(value)) {
    return value.toLowerCase() === 'true';
  }

  return stripQuotes(value);
}

function summarizePrompt(prompt: string): string | undefined {
  for (const line of prompt.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('<!--')) continue;

    const normalized = trimmed
      .replace(/^#+\s*/, '')
      .replace(/^[-*]\s*/, '')
      .trim();

    if (normalized) {
      return normalized.slice(0, 280);
    }
  }

  return undefined;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function getString(
  values: Map<string, ParsedFrontmatterValue>,
  key: string,
): string | undefined {
  const value = values.get(key);
  return typeof value === 'string' ? value : undefined;
}

function getBoolean(
  values: Map<string, ParsedFrontmatterValue>,
  key: string,
): boolean | undefined {
  const value = values.get(key);
  return typeof value === 'boolean' ? value : undefined;
}

function invertBoolean(value: boolean | undefined): boolean | undefined {
  return value === undefined ? undefined : !value;
}

function getStringArray(
  values: Map<string, ParsedFrontmatterValue>,
  key: string,
): string[] | undefined {
  const value = values.get(key);
  if (Array.isArray(value)) {
    return value.map((entry) => entry.trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return undefined;
}

function normalizeRelativePath(pathValue: string): string {
  return pathValue.split('\\').join('/');
}
