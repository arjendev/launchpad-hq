/**
 * CreateIssueModal — modal for creating a new GitHub issue via the workflow API.
 */
import { useState } from "react";
import {
  Button,
  Group,
  Modal,
  Stack,
  TextInput,
  Textarea,
} from "@mantine/core";
import { useCreateIssue } from "../services/workflow-hooks.js";

interface CreateIssueModalProps {
  opened: boolean;
  onClose: () => void;
  owner: string;
  repo: string;
}

export function CreateIssueModal({ opened, onClose, owner, repo }: CreateIssueModalProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const createIssue = useCreateIssue();

  const handleClose = () => {
    setTitle("");
    setBody("");
    onClose();
  };

  const handleCreate = () => {
    if (!title.trim()) return;
    createIssue.mutate(
      { owner, repo, title: title.trim(), body: body.trim() || undefined },
      {
        onSuccess: () => handleClose(),
      },
    );
  };

  return (
    <Modal opened={opened} onClose={handleClose} title="Create Issue" size="lg">
      <Stack gap="sm">
        <TextInput
          label="Title"
          placeholder="Issue title"
          required
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          data-autofocus
        />
        <Textarea
          label="Description"
          placeholder="Optional description…"
          minRows={4}
          maxRows={10}
          autosize
          value={body}
          onChange={(e) => setBody(e.currentTarget.value)}
        />
        <Group justify="flex-end" gap="xs">
          <Button size="sm" variant="subtle" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            loading={createIssue.isPending}
            disabled={!title.trim()}
          >
            Create
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
