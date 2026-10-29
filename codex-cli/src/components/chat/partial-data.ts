export type PartialData = {
  content: string;
  reasoning: string;
  activeToolName: string | undefined;
  activeToolArguments: Record<string, any> | undefined;
  activeBlockType: "thought" | "think" | "plan" | undefined;
};