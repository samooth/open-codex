import { Text } from "ink";
import React from "react";

/**
 * Renders a simple sparkline using Unicode block characters.
 */
export function Sparkline({
  data,
  width = 10,
  color = "green",
}: {
  data: Array<number>;
  width?: number;
  color?: string;
}) {
  if (data.length === 0) {
    return <Text>{" ".repeat(width)}</Text>;
  }

  const blocks = [" ", " ", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

  // Normalize data to fit within the sparkline width and block heights
  const displayData = data.slice(-width);
  // Pad with leading spaces if not enough data
  const paddedData = [
    ...new Array(Math.max(0, width - displayData.length)).fill(0),
    ...displayData,
  ];

  const max = Math.max(...paddedData, 100); // Assume 100 is the max percentage

  const sparkline = paddedData
    .map((val) => {
      const index = Math.floor((val / max) * (blocks.length - 1));
      return blocks[index] || " ";
    })
    .join("");

  return <Text color={color}>{sparkline}</Text>;
}
