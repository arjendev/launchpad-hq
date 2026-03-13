import { ActionIcon, Tooltip } from "@mantine/core";
import { IconSun, IconMoon } from "@tabler/icons-react";
import { useTheme } from "../contexts/ThemeContext";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <Tooltip
      label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      position="bottom"
      withArrow
    >
      <ActionIcon
        variant="subtle"
        size="md"
        onClick={toggleTheme}
        aria-label="Toggle color theme"
      >
        {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
      </ActionIcon>
    </Tooltip>
  );
}
