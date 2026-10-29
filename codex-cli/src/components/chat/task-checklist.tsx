import type { Task } from "../../utils/agent/types.js";
import type { Theme } from "../../utils/theme.js";

import { Box, Text } from "ink";
import React from "react";

type Props = {
  tasks: Array<Task>;
  theme: Theme;
};

const BAR_WIDTH = 20;

const TaskChecklist: React.FC<Props> = ({ tasks, theme }) => {
  if (tasks.length === 0) {
    return null;
  }

  const doneCount = tasks.filter((t) => t.status === "done").length;
  const inProgressCount = tasks.filter(
    (t) => t.status === "in-progress",
  ).length;
  const totalCount = tasks.length;
  const progress = totalCount > 0 ? doneCount / totalCount : 0;

  // Build a segmented progress bar: done (success) · in-progress (highlight) · todo (dim)
  const filledDone = Math.round(progress * BAR_WIDTH);
  const filledInProgress = inProgressCount > 0 ? 1 : 0;
  const filled = Math.min(BAR_WIDTH, filledDone + filledInProgress);
  const empty = BAR_WIDTH - filled;

  const activeTask = tasks.find((t) => t.status === "in-progress");

  const percent = Math.round(progress * 100);

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      paddingY={0}
      borderStyle="single"
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderLeftColor={theme.plan}
      width="100%"
      marginBottom={1}
      marginTop={1}
    >
      <Box gap={1} marginBottom={0} justifyContent="space-between">
        <Box gap={1}>
          <Text bold color={theme.plan}>
            📋 ROADMAP
          </Text>
          <Text dimColor italic>
            ({doneCount}/{totalCount})
          </Text>
        </Box>
        <Box gap={1}>
          <Text color={theme.dim}>
            [
            <Text color={theme.success}>
              {"█".repeat(filledDone)}
            </Text>
            <Text color={theme.highlight}>
              {"▓".repeat(Math.max(0, filled - filledDone))}
            </Text>
            <Text color={theme.divider}>
              {"░".repeat(empty)}
            </Text>
            ]
          </Text>
          <Text
            color={
              percent >= 100
                ? theme.success
                : percent >= 60
                  ? theme.highlight
                  : theme.dim
            }
            bold
          >
            {percent}%
          </Text>
        </Box>
      </Box>

      {activeTask && (
        <Box gap={1} marginBottom={0} paddingLeft={1}>
          <Text color={theme.highlight} bold>
            ▶
          </Text>
          <Text color={theme.highlight} bold italic>
            {typeof activeTask.label === "string"
              ? activeTask.label.toUpperCase()
              : JSON.stringify(activeTask.label).toUpperCase()}
          </Text>
        </Box>
      )}

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
