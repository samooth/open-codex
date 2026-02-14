import type { Task } from "../../utils/agent/types.js";
import type { Theme } from "../../utils/theme.js";
import { Box, Text } from "ink";
import React from "react";

type Props = {
  tasks: Task[];
  theme: Theme;
  maxHeight?: number;
};

const TaskChecklist: React.FC<Props> = ({ tasks, theme, maxHeight = 10 }) => {
  if (tasks.length === 0) return null;

  const totalDone = tasks.filter(t => t.status === "done").length;
  const isOverflowing = tasks.length > maxHeight;
  const displayedTasks = isOverflowing ? tasks.slice(0, maxHeight - 1) : tasks;

  return (
    <Box 
      flexDirection="column" 
      paddingX={1} 
      paddingY={0}
      borderStyle="classic" 
      borderColor={theme.dim}
      width="100%"
      marginBottom={0}
      height={maxHeight + 2}
      overflow="hidden"
    >
      <Box gap={1} marginBottom={0}>
        <Text bold color={theme.highlight}>📋 Current Roadmap</Text>
        <Text dimColor italic>({totalDone}/{tasks.length})</Text>
      </Box>
      <Box flexDirection="column" marginTop={0}>
        {displayedTasks.map((task, i) => {
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
              <Text color={color} bold={bold}>
                {typeof task.label === "string" 
                  ? task.label 
                  : JSON.stringify(task.label)}
              </Text>
            </Box>
          );
        })}
        {isOverflowing && (
          <Text dimColor italic>... and {tasks.length - displayedTasks.length} more steps</Text>
        )}
      </Box>
    </Box>
  );
};

export default React.memo(TaskChecklist);
