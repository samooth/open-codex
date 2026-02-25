import type { Theme } from "../utils/theme.js";

import SelectInput from "./select-input/select-input.js";
import { loadRollouts, loadRollout } from "../utils/storage/save-rollout.js";
import { Box, Text, useInput } from "ink";
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
  const [rollouts, setRollouts] = useState<Array<{ path: string; session: any }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRollouts().then(items => {
      setRollouts(items);
      setLoading(false);
    });
  }, []);

  useInput((_input, key) => {
    if (key.escape) {onExit();}
  });

  const handleSelect = async (item: any) => {
    const data = await loadRollout(item.value);
    if (data) {
      onSelect(data);
    }
  };

  const options = rollouts.map(r => ({
    label: `${new Date(r.session.timestamp).toLocaleString()} - ${r.session.model} - ${r.session.summary || 'No summary'}`,
    value: r.path
  }));

  return (
    <Box
      flexDirection="column"
      paddingLeft={1}
      borderStyle="bold"
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderLeftColor={theme.highlight}
      width={100}
      marginY={1}
    >
      {loading ? (
        <Text italic color={theme.dim}>Loading sessions...</Text>
      ) : rollouts.length === 0 ? (
        <Box gap={1} marginBottom={1}>
          <Box backgroundColor={theme.error as any} paddingX={1}>
            <Text bold color="black"> EMPTY </Text>
          </Box>
          <Text color={theme.error} bold>NO SAVED SESSIONS FOUND</Text>
        </Box>
      ) : (
        <>
          <Box gap={1} marginBottom={1}>
            <Box backgroundColor={theme.highlight as any} paddingX={1}>
              <Text bold color="black"> RESTORE </Text>
            </Box>
            <Text color={theme.highlight} bold>SELECT A PAST SESSION</Text>
          </Box>

          <Box flexDirection="column" paddingX={1} marginBottom={1}>
            <SelectInput
              items={options}
              onSelect={handleSelect}
              theme={theme}
              isFocused={true}
            />
          </Box>

          <Box 
            borderStyle="single" 
            borderRight={false} 
            borderTop={true} 
            borderBottom={false} 
            borderLeft={false}
            borderTopColor={theme.divider}
            paddingX={1}
            paddingTop={1}
          >
            <Text dimColor italic>↑↓ navigate │ enter restore │ esc close</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
