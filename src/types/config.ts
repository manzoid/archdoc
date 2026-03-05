import { basename } from "path";
import { tmpdir } from "os";

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

/**
 * Default output under /tmp/archdoc/<slug>-<timestamp>/.
 * Slug includes org/repo for readability. Each run gets its own directory.
 *
 * Examples:
 *   /tmp/archdoc/SakanaAIBusiness-marlin-20260305T082701Z/
 *   /tmp/archdoc/manzoid-archdoc-20260305T140301Z/
 */
export function defaultDirs(targetPath: string): { baseDir: string; outputDir: string; harvestDir: string } {
  const parts = targetPath.replace(/\\/g, "/").split("/");
  // Try to grab org/repo from a github-style path
  const ghIdx = parts.indexOf("github.com");
  let slug: string;
  if (ghIdx >= 0 && parts.length > ghIdx + 2) {
    slug = parts.slice(ghIdx + 1).join("-");
  } else {
    slug = basename(targetPath);
  }
  // ISO 8601 basic format: 20260305T082801Z
  const now = new Date();
  const ts = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const baseDir = `${tmpdir()}/archdoc/${slug}-${ts}`;
  return {
    baseDir,
    outputDir: `${baseDir}/output`,
    harvestDir: `${baseDir}/harvest`,
  };
}
