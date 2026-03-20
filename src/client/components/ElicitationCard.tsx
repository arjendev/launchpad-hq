/**
 * ElicitationCard — prominent card for answering coordinator questions.
 *
 * Displays the question, optional multiple-choice options, freeform text input,
 * a countdown timer, and send/dismiss actions. Transitions to "Answered ✓"
 * state briefly before fading out.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Group,
  Radio,
  Stack,
  Text,
  Textarea,
  Transition,
} from "@mantine/core";
import type { WorkflowElicitation } from "../services/workflow-types.js";
import { useRespondToElicitation } from "../services/workflow-hooks.js";

// ── Helpers ─────────────────────────────────────────────

function formatCountdown(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSecs = Math.ceil(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// ── Pulse keyframes (injected once) ─────────────────────

let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    @keyframes lp-elicitation-pulse {
      0%, 100% { border-color: var(--mantine-color-yellow-6); }
      50% { border-color: var(--mantine-color-yellow-3); }
    }
    .lp-elicitation-card {
      animation: lp-elicitation-pulse 2s ease-in-out infinite;
    }
    @keyframes lp-badge-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .lp-needs-input-badge {
      animation: lp-badge-pulse 1.5s ease-in-out infinite;
    }
  `;
  document.head.appendChild(style);
}

// ── Component ───────────────────────────────────────────

interface ElicitationCardProps {
  elicitation: WorkflowElicitation;
  owner: string;
  repo: string;
  timeoutMs?: number;
  onDismiss?: () => void;
}

export function ElicitationCard({
  elicitation,
  owner,
  repo,
  timeoutMs = 10 * 60 * 1000,
  onDismiss,
}: ElicitationCardProps) {
  ensureStyles();

  const respond = useRespondToElicitation();
  const [answer, setAnswer] = useState("");
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [visible, setVisible] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);

  // Countdown timer
  const deadline = useMemo(
    () => new Date(elicitation.timestamp).getTime() + timeoutMs,
    [elicitation.timestamp, timeoutMs],
  );
  const [remaining, setRemaining] = useState(() => Math.max(0, deadline - Date.now()));

  useEffect(() => {
    const tick = setInterval(() => {
      const left = Math.max(0, deadline - Date.now());
      setRemaining(left);
      if (left <= 0) clearInterval(tick);
    }, 1000);
    return () => clearInterval(tick);
  }, [deadline]);

  const isExpired = remaining <= 0;
  const isUrgent = remaining > 0 && remaining < 60_000;
  const hasOptions = elicitation.options && elicitation.options.length > 0;

  const handleSend = useCallback(() => {
    const value = hasOptions ? (selectedOption ?? "") : answer.trim();
    if (!value) return;

    respond.mutate(
      { owner, repo, elicitationId: elicitation.id, response: value },
      {
        onSuccess: () => {
          setAnswered(true);
          // Fade out after showing "Answered ✓" briefly
          setTimeout(() => setVisible(false), 2000);
        },
      },
    );
  }, [hasOptions, selectedOption, answer, respond, owner, repo, elicitation.id]);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    onDismiss?.();
  }, [onDismiss]);

  // Already answered or timed out on the server
  if (elicitation.status !== "pending" && !answered) {
    return null;
  }

  return (
    <Transition mounted={visible} transition="fade" duration={300}>
      {(styles) => (
        <Card
          ref={cardRef}
          id={`elicitation-${elicitation.id}`}
          className={!answered ? "lp-elicitation-card" : undefined}
          withBorder
          shadow="md"
          radius="md"
          p="md"
          style={{
            ...styles,
            borderWidth: 2,
            borderColor: answered
              ? "var(--mantine-color-green-6)"
              : "var(--mantine-color-yellow-6)",
            background: answered
              ? "var(--mantine-color-green-light)"
              : undefined,
          }}
        >
          {answered ? (
            <Group justify="center" py="sm">
              <Text size="lg" fw={600} c="green">
                Answered ✓
              </Text>
            </Group>
          ) : (
            <Stack gap="sm">
              {/* Header: issue ref + countdown */}
              <Group justify="space-between" wrap="nowrap">
                <Group gap="xs">
                  <Badge size="sm" variant="filled" color="yellow">
                    🟡 #{elicitation.issueNumber}
                  </Badge>
                  <Text size="xs" c="dimmed">needs your input</Text>
                </Group>
                <Badge
                  size="sm"
                  variant="light"
                  color={isExpired ? "red" : isUrgent ? "orange" : "gray"}
                >
                  ⏱ {isExpired ? "Expired" : formatCountdown(remaining)}
                </Badge>
              </Group>

              {/* Question */}
              <Text size="sm" fw={500}>
                {elicitation.question}
              </Text>

              {/* Input: radio buttons or freeform textarea */}
              {hasOptions ? (
                <Radio.Group
                  value={selectedOption ?? ""}
                  onChange={setSelectedOption}
                >
                  <Stack gap="xs">
                    {elicitation.options!.map((opt) => (
                      <Radio
                        key={opt}
                        value={opt}
                        label={opt}
                        size="sm"
                        disabled={isExpired}
                      />
                    ))}
                  </Stack>
                </Radio.Group>
              ) : (
                <Textarea
                  placeholder="Type your response…"
                  minRows={2}
                  maxRows={5}
                  autosize
                  value={answer}
                  onChange={(e) => setAnswer(e.currentTarget.value)}
                  disabled={isExpired}
                />
              )}

              {/* Actions */}
              <Group justify="flex-end" gap="xs">
                <Button
                  size="compact-sm"
                  variant="subtle"
                  color="gray"
                  onClick={handleDismiss}
                >
                  Skip
                </Button>
                <Button
                  size="compact-sm"
                  color="yellow"
                  onClick={handleSend}
                  loading={respond.isPending}
                  disabled={
                    isExpired ||
                    (hasOptions ? !selectedOption : !answer.trim())
                  }
                >
                  Send Response
                </Button>
              </Group>
            </Stack>
          )}
        </Card>
      )}
    </Transition>
  );
}

/**
 * Scroll to and highlight a specific elicitation card.
 */
export function scrollToElicitation(elicitationId: string) {
  const el = document.getElementById(`elicitation-${elicitationId}`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.style.transition = "box-shadow 0.3s";
    el.style.boxShadow = "0 0 0 3px var(--mantine-color-yellow-4)";
    setTimeout(() => {
      el.style.boxShadow = "";
    }, 2000);
  }
}
