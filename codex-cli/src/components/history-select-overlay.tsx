import type { Theme } from "../utils/theme.js";

import CenteredOverlay from "./centered-overlay.js";
import SelectInput from "./select-input/select-input.js";
import { loadRollouts, loadRollout } from "../utils/storage/save-rollout.js";
import { Box, Text } from "ink";
import React, { useState, useEffect } from "react";

export default function HistorySelectOverlay({
  onSelect,
  onExit,
  theme,
}: {
  onSelect: (rollout: { session: any; items: Array<any> }) => void;
  onExit: () => void;
  theme: Theme;
}) {
  const [rollouts, setRollouts] = useState<
    Array<{ path: string; session: any }>
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRollouts().then((items) => {
      setRollouts(items);
      setLoading(false);
    });
  }, []);

  const handleSelect = async (item: any) => {
    const data = await loadRollout(item.value);
    if (data) {
      onSelect(data);
    }
  };

  const options = rollouts.map((r) => ({
    label: `${r.session.summary || "untitled"} · ${new Date(
      r.session.timestamp,
    ).toLocaleDateString()} · ${r.session.model ?? ""}`,
    value: r.path,
  }));

  return (
    <CenteredOverlay
      title="restore session"
      description="Pick a past session to continue"
      footer="↑↓ navigate · enter restore · esc close"
      theme={theme}
      onExit={onExit}
    >
      {loading ? (
        <Text color={theme.dim}>Loading sessions…</Text>
      ) : rollouts.length === 0 ? (
        <Text color={theme.error}>no saved sessions found</Text>
      ) : (
        <Box flexDirection="column">
          <SelectInput
            items={options}
            onSelect={handleSelect}
            theme={theme}
            isFocused={true}
            itemsPerPage={10}
          />
        </Box>
      )}
    </CenteredOverlay>
  );
}
