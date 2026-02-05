import type { AgentLoop } from "../../utils/agent/agent-loop.js";
import type { Theme } from "../../utils/theme.js";

import { Box, Text } from "ink";
import path from "node:path";
import React from "react";

export interface TerminalHeaderProps {
  terminalRows: number;
  version: string;
  PWD: string;
  model: string;
  approvalPolicy: string;
  colorsByPolicy: Record<string, string | undefined>;
  agent?: AgentLoop;
  initialImagePaths?: Array<string>;
  theme: Theme;
}

const TerminalHeader: React.FC<TerminalHeaderProps> = ({
  terminalRows,
  version,
  PWD,
  model,
  approvalPolicy,
  colorsByPolicy,
  agent,
  initialImagePaths,
  theme,
}) => {
  return (
    <>
      {terminalRows < 10 ? (
        // Compact header for small terminal windows
        <Text>
          ● OpenCodex <Text color={theme.highlight}>v{version}</Text> – {PWD} – {model} –{" "}
          <Text color={colorsByPolicy[approvalPolicy] || theme.success}>{approvalPolicy}</Text>
        </Text>
      ) : (
        <>
          <Box borderStyle="round" paddingX={1} width={64} borderColor={theme.dim}>
            <Text>
              ● <Text bold color={theme.assistant}>OpenCodex</Text>{" "}
              <Text color={theme.highlight}>v{version}</Text>
            </Text>
          </Box>
          <Box
            borderStyle="round"
            borderColor={theme.dim}
            paddingX={1}
            width={64}
            flexDirection="column"
          >
            <Text>
              localhost <Text dimColor color={theme.dim}>session:</Text>{" "}
              <Text color={theme.statusBarSession} dimColor>
                {agent?.sessionId ?? "<no-session>"}
              </Text>
            </Text>
            <Text color={theme.dim}>
              <Text color={theme.highlight}>↳</Text> workdir: <Text bold color={theme.user}>{PWD}</Text>
            </Text>
            <Text color={theme.dim}>
              <Text color={theme.highlight}>↳</Text> model: <Text bold color={theme.user}>{model}</Text>
            </Text>
            <Text color={theme.dim}>
              <Text color={theme.highlight}>↳</Text> approval:{" "}
              <Text bold color={colorsByPolicy[approvalPolicy] || theme.success}>
                {approvalPolicy}
              </Text>
            </Text>
            {initialImagePaths?.map((img, idx) => (
              <Text key={idx} color={theme.dim}>
                <Text color={theme.highlight}>↳</Text> image:{" "}
                <Text bold color={theme.user}>{path.basename(img)}</Text>
              </Text>
            ))}
          </Box>
        </>
      )}
    </>
  );
};

export default TerminalHeader;
