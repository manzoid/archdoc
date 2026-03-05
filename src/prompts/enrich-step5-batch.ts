import { readFile, writeFile, mkdir, readdir } from "fs/promises";
import { join, basename } from "path";
import type { HarvestBag } from "../types/tool.js";
import { getHarvestData } from "../types/tool.js";
import type { TestCensusHarvest, FeatureCensusHarvest } from "../types/harvest.js";

const BATCH_SIZE = 30; // test files per batch

interface TestBatch {
  batchIndex: number;
  totalBatches: number;
  testFiles: string[];
  tests: any[];
}

/**
 * Split step 5 into batches, write prompt files, return instructions.
 */
export async function prepareStep5Batches(
  bag: HarvestBag,
  outputDir: string
): Promise<{ totalBatches: number; batchDir: string }> {
  const census = getHarvestData<TestCensusHarvest>(bag, "test-intent-map");
  if (!census) throw new Error("No test census data found in harvest");

  const batchDir = join(outputDir, "step5-batches");
  await mkdir(batchDir, { recursive: true });

  // Group tests by file
  const testsByFile = new Map<string, any[]>();
  for (const test of census.tests) {
    const existing = testsByFile.get(test.testFile) ?? [];
    existing.push(test);
    testsByFile.set(test.testFile, existing);
  }

  const allFiles = [...testsByFile.keys()].sort();
  const totalBatches = Math.ceil(allFiles.length / BATCH_SIZE);

  for (let i = 0; i < totalBatches; i++) {
    const batchFiles = allFiles.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    const batchTests = batchFiles.flatMap((f) => testsByFile.get(f) ?? []);

    const batch: TestBatch = {
      batchIndex: i + 1,
      totalBatches,
      testFiles: batchFiles,
      tests: batchTests,
    };

    // Write the batch data
    await writeFile(
      join(batchDir, `batch-${i + 1}.json`),
      JSON.stringify(batch, null, 2),
      "utf-8"
    );
  }

  return { totalBatches, batchDir };
}

/**
 * Generate a prompt for a single batch of step 5.
 */
export async function generateStep5BatchPrompt(
  bag: HarvestBag,
  outputDir: string,
  subIndex: number
): Promise<string> {
  const batchDir = join(outputDir, "step5-batches");
  const batchFile = join(batchDir, `batch-${subIndex}.json`);
  const batch: TestBatch = JSON.parse(await readFile(batchFile, "utf-8"));
  const repoPath = bag.targetPath;

  const censusJson = JSON.stringify(
    { testFiles: batch.testFiles, tests: batch.tests },
    null,
    2
  );

  return `You are classifying tests for an archdoc wiki. This is batch ${batch.batchIndex} of ${batch.totalBatches}.

=== GROUNDING RULES ===

You have filesystem access. The codebase is at: ${repoPath}
For EVERY test, read the actual test source code before classifying it.

=== INSTRUCTIONS ===

Classify each test in this batch. For each test, determine:

**A. Test Type** (exactly one):

| Type | What it checks |
|------|---------------|
| **Wiring** | Dependencies connected correctly (DI, routes map to handlers) |
| **Resilience** | Handles bad/missing/edge input (error paths, None/null, exceptions) |
| **Control Flow** | Branching / conditional logic (if/else paths, loops, guard clauses) |
| **Data Transform** | Input→output mapping correctness (parsing, formatting, shape) |
| **State Mgmt** | State changes correctly over time (create/update/delete, transitions) |
| **Contract** | Interface/schema compliance (return types, required fields, API shapes) |
| **Log Presence** | Logging and observability (asserts logger called with expected messages) |
| **Side Effect** | External side effects occur correctly (files written, APIs called, events emitted) |

Disambiguation:
- Bad input raises exception → **Resilience** (not Control Flow)
- Returns right dict shape → **Contract** (not Data Transform)
- Status changes A to B → **State Mgmt** (not Data Transform)
- Mocks external service, asserts called → **Side Effect** (not Wiring)
- Asserts logger.warning() called → **Log Presence** (not Side Effect)

**B. Code under test** — Format: \`FunctionName(): 3-8 word description\`

**C. What problem does this test prevent?** — Short question form, 5-12 words.

=== OUTPUT ===

Write a JSON array to: ${outputDir}/step5-batches/results-${subIndex}.json

Each entry:
\`\`\`json
{
  "id": <sequential number>,
  "group": "<test directory>",
  "className": "<test class or describe block>",
  "methodName": "<test method name>",
  "qualifiedName": "<className>::<methodName>",
  "type": "<one of the 8 types>",
  "testFile": "<path>",
  "testLine": <line>,
  "testEndLine": <endLine>,
  "sourceFile": "<inferred source file>",
  "codeUnderTest": "<FunctionName(): description>",
  "whatPrevents": "<question form>"
}
\`\`\`

=== TEST DATA (${batch.tests.length} tests in ${batch.testFiles.length} files) ===

\`\`\`json
${censusJson}
\`\`\`

=== GO ===

Read each test file, classify every test, write results to ${outputDir}/step5-batches/results-${subIndex}.json.`;
}

/**
 * Aggregate all batch results into final outputs.
 */
export async function generateStep5AggregatePrompt(
  bag: HarvestBag,
  outputDir: string
): Promise<string> {
  const repoName = basename(bag.targetPath);
  const batchDir = join(outputDir, "step5-batches");
  const features = getHarvestData<FeatureCensusHarvest>(bag, "repo-feature-check");

  // Find all results files
  const files = await readdir(batchDir);
  const resultFiles = files.filter((f) => f.startsWith("results-") && f.endsWith(".json")).sort();

  const featureList = features
    ? features.directoryGroups
        .slice(0, 15)
        .map((g) => `  ${g.directory}: ${g.total} symbols`)
        .join("\n")
    : "(no feature data)";

  return `You are aggregating test classification results for an archdoc wiki.

=== INSTRUCTIONS ===

1. Read all result files in ${batchDir}/:
${resultFiles.map((f) => `   - ${join(batchDir, f)}`).join("\n")}

2. Merge all JSON arrays into a single array. Re-number the "id" fields sequentially.

3. Write the merged array to: ${outputDir}/${repoName}-test-intent-map.json

4. Generate the interactive HTML report:
   - Read the HTML template: \`cat $(npm root -g)/@manzoid2/test-intent-map/templates/report.html\`
   - Find the line containing \`/*DATA_PLACEHOLDER*/[]\` and replace \`[]\` with the merged JSON array
   - Write to: ${outputDir}/${repoName}-test-intent-map.html

5. Create ${outputDir}/test-quality.md with:

   ---
   title: "Test Quality Analysis"
   slug: test-quality
   order: 7
   tags: ["tests", "quality", "coverage", "intent-map"]
   cross_refs: ["test-coverage", "feature-census", "architecture"]
   ---

   ## Type Distribution
   Table of test type counts and percentages from the merged data.

   ## Observations
   3-5 observations about the test suite distribution.

   ## Test Distribution by Module
   Cross-reference test groups against these feature census modules:
${featureList}

   ## Recommendations
   3-5 specific, actionable recommendations.

   ## Artifacts
   - Interactive report: [${repoName}-test-intent-map.html](${repoName}-test-intent-map.html)
   - Classified data: [${repoName}-test-intent-map.json](${repoName}-test-intent-map.json)

=== GO ===

Read all result files, merge, generate HTML report, write wiki page.`;
}
