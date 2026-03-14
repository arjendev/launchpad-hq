import { Group, UnstyledButton, Text, Badge } from "@mantine/core";

export type MobileTab = "projects" | "sessions" | "board";

interface MobileNavBarProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  /** Unread inbox count shown on the board tab. */
  unreadCount?: number;
}

const TABS: { id: MobileTab; emoji: string; label: string }[] = [
  { id: "projects", emoji: "📁", label: "Projects" },
  { id: "sessions", emoji: "💬", label: "Sessions" },
  { id: "board", emoji: "📋", label: "Board" },
];

export function MobileNavBar({ activeTab, onTabChange, unreadCount }: MobileNavBarProps) {
  return (
    <Group
      grow
      gap={0}
      style={{
        borderTop: "1px solid var(--lp-border)",
        background: "var(--lp-surface)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        flexShrink: 0,
      }}
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <UnstyledButton
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            py="xs"
            style={{
              textAlign: "center",
              borderTop: isActive
                ? "2px solid var(--lp-accent)"
                : "2px solid transparent",
              background: isActive
                ? "var(--mantine-color-blue-light)"
                : undefined,
              minHeight: 48,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              flexDirection: "column",
            }}
          >
            <Group gap={4} justify="center" wrap="nowrap">
              <Text size="md" lh={1}>{tab.emoji}</Text>
              {tab.id === "board" && (unreadCount ?? 0) > 0 && (
                <Badge size="xs" color="red" variant="filled" style={{ position: "relative", top: -4 }}>
                  {unreadCount}
                </Badge>
              )}
            </Group>
            <Text size="xs" fw={isActive ? 600 : 400} c={isActive ? undefined : "dimmed"}>
              {tab.label}
            </Text>
          </UnstyledButton>
        );
      })}
    </Group>
  );
}
