import { useState } from "react";
import {
  TextInput,
  Button,
  Group,
  Stack,
  Text,
  Avatar,
  UnstyledButton,
  Badge,
  Loader,
  ScrollArea,
  Box,
} from "@mantine/core";
import { useDiscoverUsers, useDiscoverRepos } from "../services/hooks.js";
import type { DiscoverUser, DiscoverRepo } from "../services/types.js";

/** Debounce delay for search inputs (ms). */
const DEBOUNCE_MS = 350;

export interface RepoSearchPickerProps {
  /** Called when a repo is selected. */
  onSelect: (owner: string, repo: string) => void;
  /** If true, already-tracked repos are shown as disabled. */
  showTracked?: boolean;
  /** Optional label override for the owner search input. */
  ownerLabel?: string;
  /** Optional placeholder override for the repo filter input. */
  repoPlaceholder?: string;
}

// ── Owner Search ─────────────────────────────────────────────────

function OwnerSearch({ onSelect }: { onSelect: (user: DiscoverUser) => void }) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (val: string) => {
    setQuery(val);
    if (debounceTimer) clearTimeout(debounceTimer);
    setDebounceTimer(
      setTimeout(() => setDebouncedQuery(val.trim()), DEBOUNCE_MS),
    );
  };

  const { data, isLoading } = useDiscoverUsers(debouncedQuery);
  const users = data?.users ?? [];

  return (
    <Stack gap="xs">
      <TextInput
        label="Search GitHub users or organizations"
        placeholder="Type a username or org…"
        value={query}
        onChange={(e) => handleChange(e.currentTarget.value)}
        data-autofocus
        rightSection={isLoading ? <Loader size="xs" /> : null}
      />
      {users.length > 0 && (
        <ScrollArea.Autosize mah={260}>
          <Stack gap={4}>
            {users.map((u) => (
              <UnstyledButton
                key={u.login}
                onClick={() => onSelect(u)}
                p="xs"
                style={{
                  borderRadius: "var(--mantine-radius-sm)",
                  border: "1px solid var(--lp-border)",
                }}
              >
                <Group gap="sm" wrap="nowrap">
                  <Avatar src={u.avatarUrl} size="sm" radius="xl" />
                  <div>
                    <Text size="sm" fw={500}>
                      {u.login}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {u.type}
                    </Text>
                  </div>
                </Group>
              </UnstyledButton>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      )}
      {debouncedQuery.length >= 2 && !isLoading && users.length === 0 && (
        <Text size="sm" c="dimmed" ta="center">
          No users found
        </Text>
      )}
    </Stack>
  );
}

// ── Repo List ────────────────────────────────────────────────────

function RepoList({
  owner,
  onSelect,
  onBack,
  showTracked,
}: {
  owner: DiscoverUser;
  onSelect: (repo: DiscoverRepo) => void;
  onBack: () => void;
  showTracked: boolean;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (val: string) => {
    setSearch(val);
    if (debounceTimer) clearTimeout(debounceTimer);
    setDebounceTimer(
      setTimeout(() => setDebouncedSearch(val.trim()), DEBOUNCE_MS),
    );
  };

  const { data, isLoading } = useDiscoverRepos(owner.login, debouncedSearch || undefined);
  const repos = data?.repos ?? [];

  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Button variant="subtle" size="compact-xs" onClick={onBack}>
          ← Back
        </Button>
        <Group gap="xs" wrap="nowrap">
          <Avatar src={owner.avatarUrl} size="xs" radius="xl" />
          <Text size="sm" fw={500}>
            {owner.login}
          </Text>
        </Group>
      </Group>

      <TextInput
        placeholder="Search repositories…"
        value={search}
        onChange={(e) => handleChange(e.currentTarget.value)}
        rightSection={isLoading ? <Loader size="xs" /> : null}
      />

      {isLoading && repos.length === 0 && (
        <Stack align="center" py="md">
          <Loader size="sm" />
        </Stack>
      )}

      {repos.length > 0 && (
        <ScrollArea.Autosize mah={300}>
          <Stack gap={4}>
            {repos.map((r) => {
              const disabled = showTracked && r.tracked;
              return (
                <UnstyledButton
                  key={r.fullName}
                  onClick={() => !disabled && onSelect(r)}
                  p="xs"
                  style={{
                    borderRadius: "var(--mantine-radius-sm)",
                    border: "1px solid var(--lp-border)",
                    opacity: disabled ? 0.5 : 1,
                    cursor: disabled ? "not-allowed" : "pointer",
                  }}
                >
                  <Group justify="space-between" wrap="nowrap">
                    <Box style={{ minWidth: 0, flex: 1 }}>
                      <Group gap={6} wrap="nowrap">
                        <Text size="sm" fw={500} truncate>
                          {r.repo}
                        </Text>
                        {r.private && (
                          <Badge size="xs" variant="light" color="gray">
                            private
                          </Badge>
                        )}
                        {showTracked && r.tracked && (
                          <Badge size="xs" variant="filled" color="blue">
                            tracked
                          </Badge>
                        )}
                      </Group>
                      {r.description && (
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {r.description}
                        </Text>
                      )}
                    </Box>
                    {r.language && (
                      <Text size="xs" c="dimmed">
                        {r.language}
                      </Text>
                    )}
                  </Group>
                </UnstyledButton>
              );
            })}
          </Stack>
        </ScrollArea.Autosize>
      )}

      {!isLoading && repos.length === 0 && (
        <Text size="sm" c="dimmed" ta="center" py="md">
          No repositories found
        </Text>
      )}
    </Stack>
  );
}

// ── Main Component ───────────────────────────────────────────────

/**
 * Two-step repo picker: search for a GitHub owner/org, then search &
 * select a repository. Calls `onSelect(owner, repo)` on selection.
 */
export function RepoSearchPicker({
  onSelect,
  showTracked = false,
}: RepoSearchPickerProps) {
  const [selectedOwner, setSelectedOwner] = useState<DiscoverUser | null>(null);

  const handleSelectRepo = (repo: DiscoverRepo) => {
    onSelect(repo.owner, repo.repo);
  };

  const handleBackToSearch = () => {
    setSelectedOwner(null);
  };

  if (selectedOwner) {
    return (
      <RepoList
        owner={selectedOwner}
        onSelect={handleSelectRepo}
        onBack={handleBackToSearch}
        showTracked={showTracked}
      />
    );
  }

  return <OwnerSearch onSelect={setSelectedOwner} />;
}
