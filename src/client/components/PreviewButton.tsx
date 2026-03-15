import { ActionIcon, Tooltip } from "@mantine/core";
import { IconDeviceDesktop } from "@tabler/icons-react";
import { useState } from "react";
import { usePreviewState } from "../services/preview-hooks.js";
import { PreviewModal } from "./PreviewModal.js";

interface PreviewButtonProps {
  projectId: string;
  projectName: string;
}

export function PreviewButton({ projectId, projectName }: PreviewButtonProps) {
  const [opened, setOpened] = useState(false);
  const { data: preview } = usePreviewState(projectId);

  const hasPreview = !!preview?.available;

  return (
    <>
      <Tooltip
        label={hasPreview ? "Open preview" : "No preview port configured"}
        position="bottom"
        withArrow
      >
        <ActionIcon
          variant="subtle"
          size="sm"
          color={hasPreview ? "green" : "gray"}
          onClick={(e) => {
            e.stopPropagation();
            if (hasPreview) setOpened(true);
          }}
          aria-label={`Preview ${projectName}`}
          disabled={!hasPreview}
        >
          <IconDeviceDesktop size={16} />
        </ActionIcon>
      </Tooltip>

      <PreviewModal
        projectId={projectId}
        projectName={projectName}
        opened={opened}
        onClose={() => setOpened(false)}
      />
    </>
  );
}
