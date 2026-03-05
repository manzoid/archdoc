import { readFile } from "fs/promises";
import { join, basename } from "path";
import type { HarvestBag } from "../types/tool.js";
import { getHarvestData } from "../types/tool.js";
import type { EnrichStepDescriptor } from "../types/tool.js";
import type { CodeStatsHarvest, FeatureCensusHarvest, GitAnalysisHarvest, TestCensusHarvest } from "../types/harvest.js";
import { enrichSteps } from "../registry.js";

// ── Public API ───────────────────────────────────────────────

/** List all enrich steps (for `archdoc enrich` with no flags) */
export function listEnrichSteps(): string {
  const sorted = [...enrichSteps].sort((a, b) => a.step - b.step);
  const lines = [
    "Available enrichment steps:\n",
    ...sorted.map((s) => `  Step ${s.step}: ${s.name} (${s.id})`),
    "",
    "Usage:",
    "  archdoc enrich --step 1        # Output prompt for a single step",
    "  archdoc enrich --all           # Output all steps as one sequenced prompt",
  ];
  return lines.join("\n");
}

/** Generate prompt for a single step */
export async function generateStepPrompt(
  harvestDir: string,
  outputDir: string,
  stepNumber: number
): Promise<string> {
  const bag = await loadBag(harvestDir);
  const sorted = [...enrichSteps].sort((a, b) => a.step - b.step);
  const step = sorted.find((s) => s.step === stepNumber);
  if (!step) {
    const available = sorted.map((s) => s.step).join(", ");
    throw new Error(`No enrich step ${stepNumber}. Available steps: ${available}`);
  }
  return step.generate(bag, outputDir);
}

/** Generate a combined prompt with all steps sequenced */
export async function generateAllStepsPrompt(
  harvestDir: string,
  outputDir: string
): Promise<string> {
  const bag = await loadBag(harvestDir);
  const repoName = basename(bag.targetPath);
  const sorted = [...enrichSteps].sort((a, b) => a.step - b.step);

  const sections: string[] = [];
  sections.push(`You are enriching the archdoc wiki for the "${repoName}" codebase.`);
  sections.push(`archdoc has generated data-driven wiki pages in ${outputDir}/.`);
  sections.push(`Your job is to work through the following ${sorted.length} steps IN ORDER.\n`);
  sections.push(`Complete each step fully before moving to the next.\n`);

  for (const step of sorted) {
    const prompt = await step.generate(bag, outputDir);
    sections.push(`${"=".repeat(60)}`);
    sections.push(`STEP ${step.step}: ${step.name}`);
    sections.push(`${"=".repeat(60)}\n`);
    sections.push(prompt);
    sections.push("");
  }

  return sections.join("\n");
}

// ── Helpers ──────────────────────────────────────────────────

async function loadBag(harvestDir: string): Promise<HarvestBag> {
  const raw = await readFile(join(harvestDir, "harvest-bag.json"), "utf-8");
  return JSON.parse(raw);
}

function harvestSummary(bag: HarvestBag): string {
  const repoName = basename(bag.targetPath);
  const codeStats = getHarvestData<CodeStatsHarvest>(bag, "scc");
  const features = getHarvestData<FeatureCensusHarvest>(bag, "repo-feature-check");
  const git = getHarvestData<GitAnalysisHarvest>(bag, "git-analysis");

  const lines: string[] = [];
  lines.push(`Repository: ${repoName}`);
  lines.push(`Path: ${bag.targetPath}`);
  lines.push(`Harvested: ${bag.harvestedAt}`);

  if (codeStats) {
    lines.push(`Code: ${codeStats.totalCode.toLocaleString()} LOC across ${codeStats.totalFiles.toLocaleString()} files in ${codeStats.languages.length} languages`);
  }
  if (features) {
    lines.push(`Symbols: ${features.totalSymbols.toLocaleString()} (${features.totals.functions}F/${features.totals.methods}M/${features.totals.classes}C)`);
  }
  if (git) {
    lines.push(`History: ${git.totalCommits.toLocaleString()} commits by ${git.contributors} contributors (${git.firstCommitDate.slice(0, 10)} to ${git.lastCommitDate.slice(0, 10)})`);
  }

  return lines.join("\n");
}

function topModulesSummary(bag: HarvestBag): string {
  const features = getHarvestData<FeatureCensusHarvest>(bag, "repo-feature-check");
  if (!features) return "(no feature data available)";
  return features.directoryGroups
    .slice(0, 15)
    .map((g) => `  ${g.directory}: ${g.total} symbols (${g.functions}F/${g.methods}M/${g.classes}C) — e.g. ${g.sampleSymbols.slice(0, 3).join(", ")}`)
    .join("\n");
}

function topLangsSummary(bag: HarvestBag): string {
  const codeStats = getHarvestData<CodeStatsHarvest>(bag, "scc");
  if (!codeStats) return "(no code stats available)";
  return codeStats.languages
    .slice(0, 8)
    .map((l) => `  ${l.Name}: ${l.Code.toLocaleString()} LOC (${l.Count} files)`)
    .join("\n");
}

function topChurnSummary(bag: HarvestBag): string {
  const git = getHarvestData<GitAnalysisHarvest>(bag, "git-analysis");
  if (!git) return "(no git data available)";
  return git.topChurnFiles
    .slice(0, 10)
    .map((f) => `  ${f.path}: ${f.commits} commits (+${f.insertions}/-${f.deletions})`)
    .join("\n");
}

// ── Step Descriptors ─────────────────────────────────────────

export const overviewEnrichStep: EnrichStepDescriptor = {
  id: "overview-narrative",
  name: "Overview Narrative",
  step: 1,
  requiredHarvests: ["scc", "repo-feature-check"],
  requiredPages: [],
  generate: async (bag, outputDir) => {
    const repoName = basename(bag.targetPath);
    return `You are enriching the archdoc wiki for the "${repoName}" codebase.

=== PROGRESS ===
Before starting: echo "[archdoc step 1] Starting Overview Narrative" >&2
When done: echo "[archdoc step 1] DONE — overview.md rewritten" >&2

=== INSTRUCTIONS ===

1. Read the existing pages in ${outputDir}/ to understand what's already generated
2. Read the harvest data summary below
3. Rewrite ${outputDir}/overview.md with:
   - A 2-3 paragraph executive summary explaining what this system does, who it's for, and why it exists
   - Infer the system's purpose from module names, symbol names, and file paths
   - Keep the Key Numbers table and Tech Stack table from the existing page
   - Add a new "## Architecture at a Glance" section with 3-5 sentences about the system design
   - Add descriptions to the Top Modules table (replace the placeholder descriptions)
   - Be specific and authoritative — don't hedge
4. Preserve the YAML frontmatter at the top of the file
5. Keep the cross-reference links at the bottom

=== HARVEST DATA SUMMARY ===

${harvestSummary(bag)}

Top Languages:
${topLangsSummary(bag)}

Top Modules:
${topModulesSummary(bag)}

Top Churn Files:
${topChurnSummary(bag)}

=== GO ===

Read the existing files in ${outputDir}/ and rewrite overview.md as described above.`;
  },
};

export const architectureEnrichStep: EnrichStepDescriptor = {
  id: "architecture-walkthrough",
  name: "Architecture Walkthrough",
  step: 2,
  requiredHarvests: ["scc", "repo-feature-check"],
  requiredPages: ["overview"],
  generate: async (bag, outputDir) => {
    return `You are continuing enrichment of the archdoc wiki.

=== PROGRESS ===
Before starting: echo "[archdoc step 2] Starting Architecture Walkthrough" >&2
When done: echo "[archdoc step 2] DONE — architecture.md written" >&2

=== CONTEXT ===

You should have already completed Step 1 (Overview Narrative).
Read ${outputDir}/overview.md to understand what's been written.

=== INSTRUCTIONS ===

Create a new file ${outputDir}/architecture.md with:

1. YAML frontmatter:
   ---
   title: "Architecture"
   slug: architecture
   order: 4
   tags: ["architecture", "design"]
   cross_refs: ["overview", "feature-census", "code-stats"]
   ---

2. Content sections:
   - "## System Architecture" — High-level description of the system's layers and boundaries
   - "## Key Design Decisions" — Notable patterns (monorepo vs polyrepo, framework choices, API style)
   - "## Module Dependency Map" — How the top modules relate to each other (text description, not diagram)
   - "## Data Flow" — How data moves through the system from input to output
   - "## Infrastructure" — Deployment model, CI/CD, environment management (infer from config files)

3. Base your analysis on:
   - The overview page you already wrote
   - The module structure and symbol names below
   - Source code exploration of key files

=== HARVEST DATA ===

${harvestSummary(bag)}

Top Modules:
${topModulesSummary(bag)}

Top Churn Files:
${topChurnSummary(bag)}

=== GO ===

Read the source code of key entry points and configuration files, then write ${outputDir}/architecture.md.`;
  },
};

export const featureDeepDivesEnrichStep: EnrichStepDescriptor = {
  id: "feature-deep-dives",
  name: "Feature Deep-Dives",
  step: 3,
  requiredHarvests: ["repo-feature-check"],
  requiredPages: ["overview", "feature-census"],
  generate: async (bag, outputDir) => {
    const features = getHarvestData<FeatureCensusHarvest>(bag, "repo-feature-check");
    const git = getHarvestData<GitAnalysisHarvest>(bag, "git-analysis");

    const moduleList = features
      ? features.directoryGroups
          .filter((g) => g.total >= 10)
          .slice(0, 15)
          .map((g) => {
            const churnFiles = git?.topChurnFiles.filter((f) =>
              f.path.startsWith(g.directory + "/") || f.path.startsWith(g.directory)
            ) ?? [];
            const churn = churnFiles.reduce((s, f) => s + f.insertions + f.deletions, 0);
            return `  - ${g.directory} (${g.total} symbols, ${g.functions}F/${g.methods}M/${g.classes}C, churn: ${churn})`;
          })
          .join("\n")
      : "(no feature data)";

    const topChurnFiles = git
      ? git.topChurnFiles.slice(0, 15).map((f) =>
          `  - ${f.path}: ${f.commits} commits (+${f.insertions}/-${f.deletions})`
        ).join("\n")
      : "(no git data)";

    return `You are continuing enrichment of the archdoc wiki.

=== PROGRESS ===
Before starting: echo "[archdoc step 3] Starting Feature Deep-Dives" >&2
After each module section: echo "[archdoc step 3] Completed module: <module name>" >&2
When done: echo "[archdoc step 3] DONE — feature-deep-dives.md written" >&2

=== CONTEXT ===

Steps 1-2 should be complete. Read ${outputDir}/overview.md, ${outputDir}/feature-census.md, and ${outputDir}/architecture.md.

=== INSTRUCTIONS ===

You are producing a **feature architecture analysis** — the most valuable page in the wiki.
This must be authoritative, specific, and grounded in source code. Read actual files.

Create ${outputDir}/feature-deep-dives.md with:

1. YAML frontmatter:
   ---
   title: "Feature Deep-Dives"
   slug: feature-deep-dives
   order: 5
   tags: ["features", "architecture", "modules"]
   cross_refs: ["feature-census", "architecture", "overview"]
   ---

2. **Feature Map Table** — For EVERY module with 10+ symbols, one row:

   | Category | Feature | Symbols | F | M | C | Churn | Hotspot | Description |
   |----------|---------|--------:|--:|--:|--:|------:|---------|-------------|

   - **Category**: Group related modules (e.g., "Data Processing", "API Layer", "Testing")
   - **Description**: 1-2 sentences explaining what this module actually does. Read the source code.
   - **Hotspot**: HIGH/MED/LOW based on churn relative to other modules

3. **Cross-Cutting Concerns** — Identify shared infrastructure used across multiple features:

   | Concern | Symbols | Used By | Notes |
   |---------|--------:|---------|-------|

   Things like: error handling, logging, config management, database access, auth,
   shared utilities, DI/service layers, external API clients.

4. **Top Hotspot Files** — The 15-20 highest churn files with their feature context:

   | Churn | Commits | Feature | File |
   |------:|--------:|---------|------|

5. **Architectural Observations** — 5-8 specific, actionable observations:

   | Observation | Affected Features | Severity |
   |-------------|-------------------|----------|

   Look for: code duplication, missing test coverage, high-churn hotspots,
   legacy code, split implementations, oversized modules, orphaned code.

6. **Per-Module Deep-Dives** — For each module with 20+ symbols, a section (## Module Name):
   - **Purpose** — What this module does (1-2 sentences)
   - **Key Components** — Most important classes/functions and what they do
   - **Dependencies** — What other modules it depends on
   - **Patterns** — Notable design patterns used

Read the actual source files for every module. Don't guess from names.

=== MODULES ===

${moduleList}

=== TOP CHURN FILES ===

${topChurnFiles}

=== GO ===

Read the source code for each module, then write ${outputDir}/feature-deep-dives.md.`;
  },
};

export const runtimeFlowsEnrichStep: EnrichStepDescriptor = {
  id: "runtime-flows",
  name: "Runtime Flows",
  step: 4,
  requiredHarvests: ["scc", "repo-feature-check"],
  requiredPages: ["overview", "architecture"],
  generate: async (bag, outputDir) => {
    return `You are continuing enrichment of the archdoc wiki.

=== PROGRESS ===
Before starting: echo "[archdoc step 4] Starting Runtime Flows" >&2
After each flow: echo "[archdoc step 4] Documented flow: <flow name>" >&2
When done: echo "[archdoc step 4] DONE — runtime-flows.md written" >&2

=== CONTEXT ===

Steps 1-3 should be complete. Read ${outputDir}/overview.md and ${outputDir}/architecture.md.

=== INSTRUCTIONS ===

Create ${outputDir}/runtime-flows.md describing key runtime sequences:

1. YAML frontmatter:
   ---
   title: "Runtime Flows"
   slug: runtime-flows
   order: 6
   tags: ["runtime", "flows", "sequences"]
   cross_refs: ["architecture", "feature-deep-dives", "overview"]
   ---

2. Identify 3-5 key use cases by reading the codebase:
   - The main "happy path" (e.g., user request → response)
   - Key background processes (jobs, workers, scheduled tasks)
   - Error/retry flows if they exist
   - Any CLI or API entry points

3. For each flow, describe:
   - **Trigger** — What initiates this flow
   - **Steps** — Ordered list of what happens (module → module → module)
   - **Key Files** — Source files involved
   - **Notes** — Edge cases, error handling, performance considerations

4. Use text-based sequence descriptions (no diagrams needed).

=== HARVEST DATA ===

${harvestSummary(bag)}

Top Modules:
${topModulesSummary(bag)}

=== GO ===

Read the source code to trace key runtime flows, then write ${outputDir}/runtime-flows.md.`;
  },
};

export const testQualityEnrichStep: EnrichStepDescriptor = {
  id: "test-intent-map",
  name: "Test Intent Map",
  step: 5,
  requiredHarvests: ["test-intent-map"],
  requiredPages: ["test-coverage"],
  generate: async (bag, outputDir) => {
    const repoName = basename(bag.targetPath);
    const census = getHarvestData<TestCensusHarvest>(bag, "test-intent-map");
    const features = getHarvestData<FeatureCensusHarvest>(bag, "repo-feature-check");

    const testSummary = census
      ? `Tests: ${census.totals.tests} across ${census.totals.testFiles} files (${census.languages.join(", ")})`
      : "(no test census data)";

    const censusJson = census
      ? JSON.stringify({
          totals: census.totals,
          languages: census.languages,
          testFiles: census.testFiles,
          tests: census.tests,
        }, null, 2)
      : "{}";

    const featureList = features
      ? features.directoryGroups
          .slice(0, 15)
          .map((g) => `  ${g.directory}: ${g.total} symbols`)
          .join("\n")
      : "(no feature data)";

    const totalTests = census?.totals.tests ?? 0;

    return `You are continuing enrichment of the archdoc wiki.

=== CONTEXT ===

Steps 1-4 should be complete. This step produces three outputs:
1. An interactive HTML intent-map report
2. A classified JSON dataset
3. A wiki page summarizing test quality

=== PROGRESS REPORTING ===

This step involves classifying ${totalTests} tests. Report progress using shell echo commands
so the user can track your work. Use this exact pattern at each milestone:

  echo "[archdoc step 5] <message>" >&2

Required progress reports:
- At the START of step 5A: echo "[archdoc step 5] Starting classification of ${totalTests} tests" >&2
- After every test FILE you finish (not every individual test): echo "[archdoc step 5] Classified N/${totalTests} tests (just finished <filename>)" >&2
- When ALL tests are classified: echo "[archdoc step 5] Classification complete: ${totalTests}/${totalTests} tests" >&2
- At the START of step 5B: echo "[archdoc step 5] Starting straggler check" >&2
- When step 5B is done: echo "[archdoc step 5] Straggler check complete" >&2
- At the START of step 5C: echo "[archdoc step 5] Generating HTML report" >&2
- When HTML is written: echo "[archdoc step 5] HTML report written" >&2
- At the START of step 5D: echo "[archdoc step 5] Writing wiki page" >&2
- When DONE: echo "[archdoc step 5] DONE — all artifacts written" >&2

Do NOT skip these progress reports. They are essential for the user to monitor progress.

=== STEP 5A: CLASSIFY EVERY TEST ===

The test census data is embedded below. For EVERY test in the census, read the test source code
(use the \`line\` and \`endLine\` fields to locate it in \`testFile\`). Also read the \`inferredSources\`
files to understand what the test exercises.

Work through tests FILE BY FILE. After finishing all tests in a file, report progress
(see PROGRESS REPORTING above). This lets the user see steady progress rather than silence.

For each test, determine three things:

**A. Test Type** (exactly one):

| Type | What it checks | Key signal |
|------|---------------|------------|
| **Wiring** | Dependencies connected correctly | Verifies the right collaborator is called, DI is correct, routes map to handlers |
| **Resilience** | Handles bad/missing/edge input | Tests error paths, None/null, invalid args, exceptions, timeouts |
| **Control Flow** | Branching / conditional logic | Tests if/else paths, loops, early returns, guard clauses |
| **Data Transform** | Input→output mapping correctness | Asserts output shape/values given specific input, parsing, formatting |
| **State Mgmt** | State changes correctly over time | Tests create/update/delete operations, state transitions, lifecycle |
| **Contract** | Interface/schema compliance | Validates return types, required fields, API response shapes |
| **Log Presence** | Logging and observability behavior | Asserts logger was called with expected messages |
| **Side Effect** | External side effects occur correctly | Verifies files written, emails sent, external APIs called, events emitted |

Disambiguation rules:
- Bad input raises exception → **Resilience** (not Control Flow)
- Returns right dict shape → **Contract** (not Data Transform)
- Status changes A to B → **State Mgmt** (not Data Transform)
- If branch picks right path → **Control Flow**
- Mocks external service, asserts called → **Side Effect** (not Wiring)
- DI/constructor receives right deps → **Wiring**
- Asserts logger.warning() called → **Log Presence** (not Side Effect)

**B. Code under test** — Format: \`FunctionName(): 3-8 word description\`
   Use present tense, no articles. Name the actual function being tested.

**C. What problem does this test prevent?** — Short question form, 5-12 words.
   Target the specific failure mode. Should feel like: "Without this test, we wouldn't know if..."

=== STEP 5B: STRAGGLER CHECK ===

The census uses regex extraction — fast but can miss edge cases. Pick 3-5 test files and verify:
- Parameterized tests (\`@pytest.mark.parametrize\`, \`test.each\`, \`t.Run()\`)
- Dynamically generated tests (loops, factories)
- Unconventional names not matching \`test_*\` / \`Test*\` / \`it()\`
- False positives: helpers with "test" in the name

Add any missed tests to your classified dataset. Note findings in the wiki page.

=== STEP 5C: GENERATE THE HTML REPORT ===

Read the HTML template:
\`\`\`
cat $(npm root -g)/@manzoid2/test-intent-map/templates/report.html
\`\`\`

Find the line containing \`/*DATA_PLACEHOLDER*/[]\` and replace \`[]\` with your classified JSON array.
Each entry:

\`\`\`json
{
  "id": 1,
  "group": "unit/repositories",
  "className": "TestCreateJob",
  "methodName": "test_creates_job",
  "qualifiedName": "TestCreateJob::test_creates_job",
  "type": "State Mgmt",
  "testFile": "path/to/test_file.py",
  "testLine": 46,
  "testEndLine": 55,
  "sourceFile": "path/to/source.py",
  "codeUnderTest": "create_job(): Allocates new job entry in memory store",
  "whatPrevents": "Will a created job start in running status?"
}
\`\`\`

Write the HTML to: ${outputDir}/${repoName}-test-intent-map.html
Write the classified JSON to: ${outputDir}/${repoName}-test-intent-map.json

=== STEP 5D: WIKI PAGE ===

Create ${outputDir}/test-quality.md with:

1. YAML frontmatter:
   ---
   title: "Test Quality Analysis"
   slug: test-quality
   order: 7
   tags: ["tests", "quality", "coverage", "intent-map"]
   cross_refs: ["test-coverage", "feature-census", "architecture"]
   ---

2. Content:

   ## Type Distribution
   Print a table of test type counts and percentages.

   ## Observations
   3-5 observations:
   - Which types are over/under-represented?
   - Are there orphan test files with no source mappings?
   - Are source files heavily tested vs not tested at all?
   - Groups with suspicious distributions (e.g., all Resilience, no Contract)?
   - Straggler findings from your verification pass

   ## Test Distribution by Module
   Cross-reference test groups against the feature census modules below.
   Which modules are well-tested vs under-tested?

   ## Recommendations
   3-5 specific, actionable recommendations prioritized by impact.

   ## Artifacts
   - Interactive report: [${repoName}-test-intent-map.html](${repoName}-test-intent-map.html)
   - Classified data: [${repoName}-test-intent-map.json](${repoName}-test-intent-map.json)

=== TEST CENSUS DATA ===

${testSummary}

\`\`\`json
${censusJson}
\`\`\`

=== MODULE DATA (for cross-referencing) ===

${featureList}

=== HARVEST CONTEXT ===

${harvestSummary(bag)}

=== GO ===

Read every test file to classify each test, generate the interactive HTML report, write the classified JSON, and create the wiki page.`;
  },
};
