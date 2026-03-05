import type { HarvestToolDescriptor, GeneratorDescriptor, EnrichStepDescriptor } from "./types/tool.js";

import { sccTool } from "./harvest/scc.js";
import { repoFeatureCheckTool } from "./harvest/repo-feature-check.js";
import { gitAnalysisTool } from "./harvest/git-analysis.js";
import { testIntentMapTool } from "./harvest/test-intent-map.js";

import { overviewGenerator } from "./generators/overview.js";
import { codeStatsGenerator } from "./generators/code-stats.js";
import { featureCensusGenerator } from "./generators/feature-census.js";
import { testCoverageGenerator } from "./generators/test-coverage.js";

import { overviewEnrichStep } from "./prompts/enrich.js";
import { architectureEnrichStep } from "./prompts/enrich.js";
import { featureDeepDivesEnrichStep } from "./prompts/enrich.js";
import { runtimeFlowsEnrichStep } from "./prompts/enrich.js";
import { testQualityEnrichStep } from "./prompts/enrich.js";

// ── Harvest Tools ────────────────────────────────────────────
// To add a new tool: import it and add it to this array.

export const harvestTools: HarvestToolDescriptor[] = [
  sccTool,
  repoFeatureCheckTool,
  gitAnalysisTool,
  testIntentMapTool,
];

// ── Generators ───────────────────────────────────────────────
// To add a new generator: import it and add it to this array.

export const generators: GeneratorDescriptor[] = [
  overviewGenerator,
  codeStatsGenerator,
  featureCensusGenerator,
  testCoverageGenerator,
];

// ── Enrich Steps ─────────────────────────────────────────────
// Steps are sorted by their `step` number at runtime.

export const enrichSteps: EnrichStepDescriptor[] = [
  overviewEnrichStep,
  architectureEnrichStep,
  featureDeepDivesEnrichStep,
  runtimeFlowsEnrichStep,
  testQualityEnrichStep,
];
