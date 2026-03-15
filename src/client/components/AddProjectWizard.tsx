import { useState } from "react";
import {
  Modal,
  Button,
  Group,
  Stack,
  Text,
  Alert,
  Loader,
  Stepper,
} from "@mantine/core";
import { useAddProject } from "../services/hooks.js";
import { RepoSearchPicker } from "./RepoSearchPicker.js";
import { DaemonSetupInstructions } from "./DaemonSetupInstructions.js";

interface AddProjectWizardProps {
  opened: boolean;
  onClose: () => void;
}

// ── Main Wizard ────────────────────────────────────────────────────

export function AddProjectWizard({
  opened,
  onClose,
}: AddProjectWizardProps) {
  const [step, setStep] = useState(0);
  const [createdProject, setCreatedProject] = useState<{
    owner: string;
    repo: string;
    token: string;
  } | null>(null);

  const addProject = useAddProject();

  const resetAndClose = () => {
    setStep(0);
    setCreatedProject(null);
    addProject.reset();
    onClose();
  };

  const handleSelectRepo = (owner: string, repo: string) => {
    addProject.mutate(
      { owner, repo },
      {
        onSuccess: (data) => {
          setCreatedProject({
            owner,
            repo,
            token: data.daemonToken ?? "",
          });
          setStep(1);
        },
      },
    );
  };

  return (
    <Modal
      opened={opened}
      onClose={resetAndClose}
      title={step === 0 ? "Add Project" : "Daemon Setup"}
      size="md"
    >
      <Stepper
        active={step}
        size="xs"
        mb="md"
        allowNextStepsSelect={false}
      >
        <Stepper.Step label="Select repo" />
        <Stepper.Step label="Daemon setup" />
      </Stepper>

      {step === 0 && (
        <Stack gap="sm">
          {addProject.isError && (
            <Alert color="red" variant="light">
              <Text size="sm">{addProject.error.message}</Text>
            </Alert>
          )}

          {addProject.isPending && (
            <Alert color="blue" variant="light">
              <Group gap="xs">
                <Loader size="xs" />
                <Text size="sm">Adding project…</Text>
              </Group>
            </Alert>
          )}

          <RepoSearchPicker onSelect={handleSelectRepo} showTracked />
        </Stack>
      )}

      {step === 1 && createdProject && (
        <Stack gap="md">
          <Alert color="green" variant="light">
            <Text size="sm">
              Project <strong>{createdProject.owner}/{createdProject.repo}</strong> added successfully!
            </Text>
          </Alert>
          <DaemonSetupInstructions
            owner={createdProject.owner}
            repo={createdProject.repo}
            token={createdProject.token}
          />
          <Group justify="flex-end" mt="xs">
            <Button onClick={resetAndClose} size="xs">
              Done
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
