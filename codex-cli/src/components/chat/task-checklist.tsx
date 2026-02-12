import type { Task } from "../../utils/agent/types.js";
import type { Theme } from "../../utils/theme.js";
import { Box, Text } from "ink";
import React from "react";

type Props = {
  tasks: Task[];
  theme: Theme;
};

const TaskChecklist: React.FC<Props> = ({ tasks, theme }) => {
  if (tasks.length === 0) return null;

  return (
    <Box 
      flexDirection="column" 
      paddingX={1} 
      paddingY={0}
      borderStyle="round" 
      borderColor={theme.dim}
      width="100%"
      marginBottom={0}
    >
      <Box gap={1} marginBottom={0}>
        <Text bold color={theme.highlight}>📋 Current Roadmap</Text>
        <Text dimColor italic>({tasks.filter(t => t.status === "done").length}/{tasks.length})</Text>
      </Box>
      <Box flexDirection="column" marginTop={0}>
        {tasks.map((task, i) => {
          let icon = "⬜";
          let color = theme.dim;
          let bold = false;

          if (task.status === "done") {
            icon = "✅";
            color = theme.success;
          } else if (task.status === "in-progress") {
            icon = "🔄";
            color = theme.highlight;
            bold = true;
          }

          return (
            <Box key={i} gap={1}>
              <Text>{icon}</Text>
              <Text color={color} bold={bold}>{task.label}</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

export default React.memo(TaskChecklist);
