import { Box, Text, useInput } from "ink";
import React, { useEffect, useState } from "react";
// @ts-expect-error select.js is JavaScript and has no types
import { Select } from "./vendor/ink-select/select.js";
import { loadRollouts, loadRollout } from "../utils/storage/save-rollout.js";

export default function HistorySelectOverlay({
  onSelect,
  onExit,
}: {
  onSelect: (rollout: any) => void;
  onExit: () => void;
}) {
  const [rollouts, setRollouts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    loadRollouts().then((loaded) => {
      setRollouts(loaded);
      setLoading(false);
    });
  }, []);

  useInput((_input, key) => {
    if (key.escape) {
      onExit();
    }
  });

  if (loading || restoring) {
    return (
      <Box borderStyle="round" borderColor="blue" paddingX={1}>
        <Text italic>{restoring ? "Restoring session..." : "Loading session history..."}</Text>
      </Box>
    );
  }

  if (rollouts.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold>Restore Past Session</Text>
        </Box>
        <Text color="red">No saved sessions found.</Text>
        <Box marginTop={1}>
          <Text dimColor>Press Esc to cancel</Text>
        </Box>
      </Box>
    );
  }

  const options = rollouts.map((r, i) => {
    const date = new Date(r.session.timestamp).toLocaleString();
    const summary = r.session.summary || "No prompt summary available";

    return {
      label: `${date} - ${summary}`,
      value: i.toString(),
    };
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>Restore Past Session</Text>
      </Box>
      <Box borderStyle="single" paddingX={1}>
        <Select
          options={options}
          onChange={async (value: string) => {
            const meta = rollouts[parseInt(value)];
            if (meta) {
              setRestoring(true);
              const fullRollout = await loadRollout(meta.path);
              if (fullRollout) {
                onSelect(fullRollout);
              } else {
                setRestoring(false);
              }
            }
          }}
        />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Use arrow keys to select • Press <Text bold>Enter</Text> to restore • <Text bold>Esc</Text> to cancel
        </Text>
      </Box>
    </Box>
  );
}
