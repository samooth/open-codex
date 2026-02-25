import type { AppConfig } from "./utils/config";

import { SinglePassApp } from "./components/singlepass-cli-app";
import { getTheme } from "./utils/theme.js";
import { render } from "ink";
import React from "react";
import { Readable } from "stream";

export async function runSinglePass({
  originalPrompt,
  config,
  rootPath,
}: {
  originalPrompt?: string;
  config: AppConfig;
  rootPath: string;
}): Promise<void> {
  const theme = getTheme(config.theme);
  return new Promise((resolve) => {
    render(
      <SinglePassApp
        originalPrompt={originalPrompt}
        config={config}
        rootPath={rootPath}
        onExit={() => resolve()}
        theme={theme}
      />,
      {
        stdin: process.stdin.isTTY
          ? process.stdin
          :  
            (new Readable({
              read() {},
            }) as NodeJS.ReadStream),
      },
    );
  });
}

export default {};
