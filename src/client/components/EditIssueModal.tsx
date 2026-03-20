/**
 * EditIssueModal — modal for editing an issue's title/body with discussion thread.
 * Shows editable fields, GitHub comments, and action buttons (Dispatch, Done, Reject, Save).
 */
import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Divider,
  Group,
  Modal,
  Paper,
  ScrollArea,
  Skeleton,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import {
  useIssueComments,
  useUpdateIssue,
  useTransitionIssue,
  useDispatchIssue,
} from "../services/workflow-hooks.js";
import { WORKFLOW_STATE_CONFIG, type WorkflowIssue } from "../services/workflow-types.js";

interface EditIssueModalProps {
  opened: boolean;
  onClose: () => void;
  issue: WorkflowIssue | null;
  owner: string;
  repo: string;
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function EditIssueModal({ opened, onClose, issue, owner, repo }: EditIssueModalProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const updateIssue = useUpdateIssue();
  const transition = useTransitionIssue();
  const dispatch = useDispatchIssue();
  const { data: commentsData, isLoading: commentsLoading } = useIssueComments(
    opened ? owner : undefined,
    opened ? repo : undefined,
    opened ? issue?.number : undefined,
  );

  // Sync local state when issue changes
  useEffect(() => {
    if (issue) {
      setTitle(issue.title);
      setBody("");
    }
  }, [issue]);

  if (!issue) return null;

  const hasChanges = title !== issue.title || body.trim() !== "";
  const isActiveState = issue.state !== "done" && issue.state !== "rejected";
  const stateConfig = WORKFLOW_STATE_CONFIG[issue.state];

  const handleSave = () => {
    const payload: { owner: string; repo: string; issueNumber: number; title?: string; body?: string } = {
      owner,
      repo,
      issueNumber: issue.number,
    };
    if (title !== issue.title) payload.title = title;
    if (body.trim()) payload.body = body.trim();
    updateIssue.mutate(payload, { onSuccess: () => onClose() });
  };

  const handleTransition = (newState: "done" | "rejected") => {
    transition.mutate(
      { owner, repo, issueNumber: issue.number, newState },
      { onSuccess: () => onClose() },
    );
  };

  const handleDispatch = () => {
    dispatch.mutate(
      { owner, repo, issueNumber: issue.number },
      { onSuccess: () => onClose() },
    );
  };

  const comments = commentsData?.comments ?? [];
  const isPending = updateIssue.isPending || transition.isPending || dispatch.isPending;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <Text fw={600}>Edit Issue #{issue.number}</Text>
          <Badge size="sm" variant="light" color={stateConfig.color}>
            {stateConfig.emoji} {stateConfig.label}
          </Badge>
        </Group>
      }
      size="lg"
    >
      <Stack gap="md">
        {/* Editable fields */}
        <TextInput
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          data-autofocus
        />
        <Textarea
          label="Body"
          placeholder="Add or update description…"
          minRows={3}
          maxRows={8}
          autosize
          value={body}
          onChange={(e) => setBody(e.currentTarget.value)}
        />

        {/* Discussion section */}
        <Divider label="Discussion" labelPosition="left" />

        {commentsLoading ? (
          <Stack gap="xs">
            <Skeleton height={60} radius="sm" />
            <Skeleton height={60} radius="sm" />
          </Stack>
        ) : comments.length === 0 ? (
          <Text size="sm" c="dimmed" ta="center" py="sm">
            No comments yet.
          </Text>
        ) : (
          <ScrollArea h={220} offsetScrollbars>
            <Stack gap="xs">
              {comments.map((comment, idx) => (
                <Paper key={idx} withBorder p="xs" radius="sm">
                  <Group gap="xs" mb={4}>
                    <Text size="xs" fw={700}>{comment.author}</Text>
                    <Text size="xs" c="dimmed">{formatRelativeTime(comment.createdAt)}</Text>
                  </Group>
                  <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                    {comment.body}
                  </Text>
                </Paper>
              ))}
            </Stack>
          </ScrollArea>
        )}

        {/* Action buttons */}
        <Divider />
        <Group justify="space-between">
          <Group gap="xs">
            {issue.state === "backlog" && (
              <Button
                size="sm"
                color="blue"
                variant="light"
                onClick={handleDispatch}
                loading={dispatch.isPending}
                disabled={isPending}
              >
                ▶ Dispatch
              </Button>
            )}
            {isActiveState && (
              <>
                <Button
                  size="sm"
                  color="teal"
                  variant="light"
                  onClick={() => handleTransition("done")}
                  loading={transition.isPending}
                  disabled={isPending}
                >
                  Done
                </Button>
                <Button
                  size="sm"
                  color="red"
                  variant="light"
                  onClick={() => handleTransition("rejected")}
                  loading={transition.isPending}
                  disabled={isPending}
                >
                  Reject
                </Button>
              </>
            )}
          </Group>
          <Group gap="xs">
            <Button size="sm" variant="subtle" onClick={onClose}>
              Cancel
            </Button>
            {hasChanges && (
              <Button
                size="sm"
                onClick={handleSave}
                loading={updateIssue.isPending}
                disabled={isPending || !title.trim()}
              >
                Save
              </Button>
            )}
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
