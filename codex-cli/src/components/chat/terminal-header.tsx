import type { AgentLoop } from "../../utils/agent/agent-loop.js";
import type { Theme } from "../../utils/theme.js";

import { useTerminalSize } from "../../hooks/use-terminal-size.js";
import { Box, Text } from "ink";
import path from "node:path";
import React from "react";

export interface TerminalHeaderProps {
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
  version,
  PWD,
  model,
  approvalPolicy,
  colorsByPolicy,
  agent,
  initialImagePaths,
  theme,
}) => {
  const { columns: terminalCols, rows: terminalRows } = useTerminalSize();

  // For very small terminals, render a compact, single-line header
  if (terminalRows < 8 || terminalCols < 80) {
    return (
      <Box>
        <Text>
          ● OpenCodex <Text color={theme.highlight}>v{version}</Text> – {PWD} – {model} –{" "}
          <Text color={colorsByPolicy[approvalPolicy] || theme.success}>{approvalPolicy}</Text>
        </Text>
      </Box>
    );
  }

  // --- Main Header Design ---
  const title = ` OpenCodex v${version} `;
  const topBorder = "┌─" + title + "─".repeat(terminalCols - title.length - 3) + "┐";
  const bottomBorder = "└" + "─".repeat(terminalCols - 2) + "┘";
  const emptyLine = "│" + " ".repeat(terminalCols - 2) + "│";

  const sessionInfo = `Session:  ${agent?.sessionId ?? "<no-session>"}`;
  const workdirInfo = `Workdir:  ${PWD}`;
  const modelInfo = `Model:    ${model}`;
  const approvalInfo = `Approval: ${approvalPolicy}`;

  const imageLines = (initialImagePaths || []).map(p => `Image:    ${path.basename(p)}`);
  const allInfo = [sessionInfo, workdirInfo, modelInfo, approvalInfo, ...imageLines];

  return (
    <Box flexDirection="column">
      <Text color={theme.dim}>{topBorder}</Text>
      <Text color={theme.dim}>{emptyLine}</Text>
      {allInfo.map((line, index) => (
         <Text key={index} color={theme.dim}>
           {'│'}{'   '}
           <Text color={theme.user}>
             {line.startsWith('Approval:') ? (
               <>
                 Approval: <Text bold color={colorsByPolicy[approvalPolicy] || theme.success}>
                   {approvalPolicy}
                 </Text>
               </>
             ) : (
               line
             )}
           </Text>
           {' '.repeat(Math.max(0, terminalCols - line.length - 5))}{'│'}
         </Text>
      ))}
      <Text color={theme.dim}>{emptyLine}</Text>
      <Text color={theme.dim}>{bottomBorder}</Text>
    </Box>
  );
};

export default TerminalHeader;
