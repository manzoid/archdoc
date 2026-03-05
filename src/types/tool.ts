import type { ArchdocConfig } from "./config.js";
import type { WikiPage, WikiPageFrontmatter } from "./wiki.js";

// ── Harvest ──────────────────────────────────────────────────

export interface HarvestContext {
  churnSince?: string;
}

export interface HarvestToolDescriptor<TOutput = unknown> {
  id: string;
  name: string;
  requiredBinary: string | null;
  dependsOn?: string[];
  checkAvailability: () => Promise<boolean>;
  run: (targetPath: string, config: ArchdocConfig, context: HarvestContext) => Promise<TOutput>;
}

export type ToolResult<T = unknown> =
  | { status: "success"; toolId: string; data: T; durationMs: number }
  | { status: "skipped"; toolId: string; reason: string }
  | { status: "error"; toolId: string; error: string };

export interface HarvestBag {
  results: Record<string, unknown>;
  resultMeta: Record<string, ToolResult>;
  targetPath: string;
  harvestedAt: string;
}

/** Type-safe accessor for harvest data */
export function getHarvestData<T>(bag: HarvestBag, toolId: string): T | undefined {
  const meta = bag.resultMeta[toolId];
  if (!meta || meta.status !== "success") return undefined;
  return bag.results[toolId] as T;
}

// ── Generator ────────────────────────────────────────────────

export interface GeneratorDescriptor {
  id: string;
  name: string;
  requiredHarvests: { toolId: string; optional?: boolean }[];
  pageDefaults: WikiPageFrontmatter;
  generate: (bag: HarvestBag, config: ArchdocConfig) => WikiPage | null;
}

// ── Enrich ───────────────────────────────────────────────────

export interface EnrichStepDescriptor {
  id: string;
  name: string;
  step: number;
  requiredHarvests: string[];
  requiredPages: string[];
  generate: (bag: HarvestBag, outputDir: string) => Promise<string>;
}
