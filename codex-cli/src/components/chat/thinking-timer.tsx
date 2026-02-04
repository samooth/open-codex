import { Text } from "ink";
import React, { useEffect, useState } from "react";
import type { Theme } from "../../utils/theme.js";

export default function ThinkingTimer({
  loading,
  theme,
}: {
  loading: boolean;
  theme: Theme;
}) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!loading) {
      setSeconds(0);
      return;
    }

    const interval = setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [loading]);

  if (!loading) return null;

  return <Text color={theme.warning}>{`(${seconds}s)`}</Text>;
}
