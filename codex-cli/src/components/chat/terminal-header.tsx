import type { AgentLoop } from "../../utils/agent/agent-loop.js";
import type { Theme } from "../../utils/theme.js";

import { TerminalHyperlink, getFileUrl } from "./terminal-hyperlink.js";
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
  breadcrumb?: string;
}

const TerminalHeader: React.FC<TerminalHeaderProps> = ({
  version,
  PWD,
  model,
  approvalPolicy,
  colorsByPolicy,
  theme,
  breadcrumb,
}) => {
  const { columns: terminalCols } = useTerminalSize();

  const labelStyle = { color: theme.dim };
  const valueStyle = { color: theme.highlight, bold: true };
  const separator = <Text color={theme.divider}> │ </Text>;

  return (
    <Box 
      width={terminalCols} 
      paddingX={1} 
      borderStyle="single" 
      borderTop={false} 
      borderLeft={false} 
      borderRight={false} 
      borderBottomColor={theme.divider}
      marginBottom={1}
      flexDirection="column"
    >
      <Box flexDirection="row">
        <Box flexGrow={1}>
          <Text {...labelStyle}>OpenCodex </Text>
          <Text {...valueStyle}>v{version}</Text>
          {separator}
          <Text {...labelStyle}>📁 </Text>
          <TerminalHyperlink url={getFileUrl(process.cwd())} color={valueStyle.color}>
            <Text {...valueStyle}>{PWD}</Text>
          </TerminalHyperlink>
        </Box>
        <Box>
          <Text {...labelStyle}>🤖 </Text>
          <Text {...valueStyle}>{model}</Text>
          {separator}
          <Text {...labelStyle}>🛡️ </Text>
          <Text color={colorsByPolicy[approvalPolicy] || theme.success} bold>{approvalPolicy}</Text>
        </Box>
      </Box>
      {breadcrumb && (
        <Box marginTop={0}>
          <Text color={theme.dim}>❯ </Text>
          <TerminalHyperlink url={getFileUrl(breadcrumb)} color={theme.highlight}>
            <Text color={theme.highlight} italic>{breadcrumb}</Text>
          </TerminalHyperlink>
        </Box>
      )}
    </Box>
  );
};

export default TerminalHeader;
