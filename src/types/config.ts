export type OutputFormat = "site" | "markdown";
export type PipelinePhase = "harvest" | "generate" | "render" | "assemble";

export interface ArchdocConfig {
  output: OutputFormat;
  targetPath: string;
  outputDir: string;
  harvestDir: string;
  only?: PipelinePhase;
  pages?: string[];
  churnSince?: string;
  skipTools?: string[];
}

export const DEFAULT_CONFIG: Omit<ArchdocConfig, "targetPath"> = {
  output: "markdown",
  outputDir: "archdoc-output",
  harvestDir: "harvest",
};
