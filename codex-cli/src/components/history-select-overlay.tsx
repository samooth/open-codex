import { Box, Text, useInput } from "ink";
import React, { useEffect, useState, useMemo } from "react";
// @ts-expect-error select.js is JavaScript and has no types
import { Select } from "./vendor/ink-select/select.js";
import TextInput from "./vendor/ink-text-input.js";
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
  const [filter, setFilter] = useState("");
  const [isSearching, setIsFiltering] = useState(false);

  useEffect(() => {
    loadRollouts().then((loaded) => {
      setRollouts(loaded);
      setLoading(false);
    });
  }, []);

  useInput((input, key) => {
    if (key.escape) {
      onExit();
    }
    if (input === "/" && !isSearching) {
      setIsFiltering(true);
    }
  });

  const filteredRollouts = useMemo(() => {
    if (!filter) return rollouts;
    const f = filter.toLowerCase();
    return rollouts.filter((r) => {
      const summary = (r.session.summary || "").toLowerCase();
      const date = new Date(r.session.timestamp).toLocaleString().toLowerCase();
      const model = (r.session.model || "").toLowerCase();
      return summary.includes(f) || date.includes(f) || model.includes(f);
    });
  }, [rollouts, filter]);

  if (loading || restoring) {
    return (
      <Box borderStyle="round" borderColor="blue" paddingX={1}>
        <Text italic>
          {restoring ? "Restoring session..." : "Loading session history..."}
        </Text>
      </Box>
    );
  }

  if (rollouts.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="blue"
        paddingX={1}
      >
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

  const options = filteredRollouts.map((r, i) => {
    const date = new Date(r.session.timestamp).toLocaleString();
    const summary = r.session.summary || "No prompt summary available";
    const model = r.session.model ? `[${r.session.model}] ` : "";

    return {
      label: `${date} - ${model}${summary}`,
      value: i.toString(),
    };
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="blue"
      paddingX={1}
      width={100}
    >
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold>Restore Past Session ({filteredRollouts.length})</Text>
        {isSearching ? (
          <Box gap={1}>
            <Text color="cyan">Search: </Text>
            <TextInput
              value={filter}
              onChange={setFilter}
              onSubmit={() => setIsFiltering(false)}
            />
          </Box>
        ) : (
          <Text dimColor>Press <Text bold>/</Text> to search</Text>
        )}
      </Box>

      <Box borderStyle="single" paddingX={1} flexDirection="column">
        {options.length > 0 ? (
          <Select
            options={options}
            focus={!isSearching}
            onChange={async (value: string) => {
              const meta = filteredRollouts[parseInt(value)];
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
        ) : (
          <Text color="yellow">No sessions match your search.</Text>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          Use arrow keys to select • Press <Text bold>Enter</Text> to restore •{" "}
          <Text bold>Esc</Text> to cancel
        </Text>
      </Box>
    </Box>
  );
}
