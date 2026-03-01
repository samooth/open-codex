import type { Task } from "../../utils/agent/types.js";
import type { Theme } from "../../utils/theme.js";

import { Box, Text } from "ink";
import React from "react";

type Props = {
  tasks: Array<Task>;
  theme: Theme;
};

const TaskChecklist: React.FC<Props> = ({ tasks, theme }) => {
  if (tasks.length === 0) {
    return null;
  }

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      paddingY={0}
      borderStyle="bold"
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderLeftColor={theme.plan}
      width="100%"
      marginBottom={1}
      marginTop={1}
    >
      <Box gap={1} marginBottom={0}>
        <Text bold color={theme.plan}>
          📋 ROADMAP
        </Text>
        <Text dimColor italic>
          ({tasks.filter((t) => t.status === "done").length}/{tasks.length})
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={0}>
        {tasks.map((task, i) => {
          let icon = "  ○";
          let color = theme.dim;
          let bold = false;

          if (task.status === "done") {
            icon = "  ●";
            color = theme.success;
          } else if (task.status === "in-progress") {
            icon = "  ▶";
            color = theme.highlight;
            bold = true;
          }

          return (
            <Box key={i} gap={1}>
              <Text color={color}>{icon}</Text>
              <Text color={color} bold={bold}>
                {typeof task.label === "string"
                  ? task.label.toUpperCase()
                  : JSON.stringify(task.label).toUpperCase()}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

export default React.memo(TaskChecklist);
