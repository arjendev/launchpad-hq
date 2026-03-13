import { useState } from "react";
import {
  Modal,
  TextInput,
  Button,
  Group,
  Stack,
  Text,
  Alert,
} from "@mantine/core";
import { useAddProject } from "../api/hooks.js";

interface AddProjectDialogProps {
  opened: boolean;
  onClose: () => void;
}

export function AddProjectDialog({ opened, onClose }: AddProjectDialogProps) {
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const addProject = useAddProject();

  const handleSubmit = () => {
    if (!owner.trim() || !repo.trim()) return;
    addProject.mutate(
      { owner: owner.trim(), repo: repo.trim() },
      {
        onSuccess: () => {
          setOwner("");
          setRepo("");
          addProject.reset();
          onClose();
        },
      },
    );
  };

  const handleClose = () => {
    setOwner("");
    setRepo("");
    addProject.reset();
    onClose();
  };

  return (
    <Modal opened={opened} onClose={handleClose} title="Add Project" size="sm">
      <Stack gap="sm">
        {addProject.isError && (
          <Alert color="red" variant="light">
            <Text size="sm">{addProject.error.message}</Text>
          </Alert>
        )}
        <TextInput
          label="Owner"
          placeholder="github-username-or-org"
          value={owner}
          onChange={(e) => setOwner(e.currentTarget.value)}
          data-autofocus
        />
        <TextInput
          label="Repository"
          placeholder="repo-name"
          value={repo}
          onChange={(e) => setRepo(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
        />
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={handleClose} size="xs">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            loading={addProject.isPending}
            disabled={!owner.trim() || !repo.trim()}
            size="xs"
          >
            Add
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
