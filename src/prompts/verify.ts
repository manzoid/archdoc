import { readFile } from "fs/promises";
import { join, basename } from "path";
import type { HarvestBag } from "../types/tool.js";

export async function generateVerifyPrompt(
  harvestDir: string,
  outputDir: string,
): Promise<string> {
  const raw = await readFile(join(harvestDir, "harvest-bag.json"), "utf-8");
  const bag: HarvestBag = JSON.parse(raw);
  const targetPath = bag.targetPath;
  const repoName = basename(targetPath);

  return `You are fact-checking AI-generated documentation for the "${repoName}" codebase.
This is a verification pass — do not rewrite or improve the docs, only find and report inaccuracies.

Repo: ${targetPath}
Docs: ${outputDir}/

=== PROGRESS ===

Before starting: echo "[archdoc verify] Starting verification pass" >&2
After each phase: echo "[archdoc verify] Phase N complete — M issues found" >&2
(phases: 1=numeric, 2=behavioral, 3=completeness, 4=consistency)
When done: echo "[archdoc verify] DONE — issues.json written" >&2

=== PHASE 1: NUMERIC FACT-CHECK ===

Read all .md files in ${outputDir}/. Extract every numeric claim — counts of classes/methods/
files/tests, default parameter values, percentages, sizes, timeouts. For each claim:

1. Write a shell command that produces the ground truth from the repo
2. Run the command against ${targetPath}
3. Compare result to the claimed value — flag if off by more than 10% or clearly wrong

Common verification patterns:
- Class count: grep -rE "^class ClassName" <dir>/ | wc -l
- Default value: grep -n "param_name" <file> | head -10
- Test count: python -m pytest --collect-only -q <dir>/ 2>/dev/null | tail -3
- File count: find <dir> -name "*.ext" | wc -l

=== PHASE 2: BEHAVIORAL CLAIM CHECK ===

Read overview.md, architecture.md, feature-deep-dives.md, runtime-flows.md.
Select 20 specific, concrete, verifiable claims. Prioritize these high-risk claim types:

- **Concurrency/parallelism claims** — read the actual implementation file; look for
  concurrent.futures, asyncio.gather, threading.Thread, Promise.all, etc. before accepting
- **Absence claims** ("no tests for X", "X is not implemented") — verify before accepting
- **Default value claims** — check both code defaults and config files; distinguish them
- **Behavioral flow descriptions** — trace through actual function calls, not just names
- **Counts** (N error classes, N pipeline stages) — verify programmatically where possible

For each claim, verdict: VERIFIED, INACCURATE (state what code actually shows), or UNVERIFIABLE.

=== PHASE 3: COMPLETENESS CHECK ===

List the top-level directories and major modules in the repo.
For each significant module, note if it's absent or substantially underweighted in the docs.
Report as low-severity issues.

=== PHASE 4: INTERNAL CONSISTENCY ===

Without touching the repo, cross-reference the doc files only.

For each key numeric or structural claim — service count, stage count, module count, pipeline
step count, component count, layer count, etc. — find every place it is stated across all .md
files in ${outputDir}/. Flag any contradictions where two docs state different values for the
same thing.

Example: if runtime-flows.md says "three services" but architecture.md says "four services",
that is a "consistency" issue. Flag both documents so both can be corrected.

Report each contradiction as a pair of issues, one per conflicting document.

=== OUTPUT ===

Write ${outputDir}/issues.json with this structure:

[
  {
    "type": "numeric" | "behavioral" | "absence" | "completeness" | "consistency",
    "severity": "high" | "medium" | "low",
    "doc": "architecture.md",
    "section": "approximate section heading where the claim appears",
    "claim": "exact quote from the doc",
    "finding": "what the code or shell command actually shows",
    "fix": "corrected text to replace the claim with"
  }
]

Include ONLY confirmed inaccuracies and clear gaps — not style suggestions or improvements.
A "high" severity issue is one that would materially mislead a reader about how the system works.

Print a summary of all issues to stdout, grouped by severity.`;
}

export async function generateFixPrompt(
  harvestDir: string,
  outputDir: string,
): Promise<string> {
  const raw = await readFile(join(harvestDir, "harvest-bag.json"), "utf-8");
  const bag: HarvestBag = JSON.parse(raw);
  const repoName = basename(bag.targetPath);

  let issuesJson: string;
  try {
    issuesJson = await readFile(join(outputDir, "issues.json"), "utf-8");
  } catch {
    throw new Error(`No issues.json found in ${outputDir}. Run 'archdoc verify' first.`);
  }

  return `You are applying corrections to AI-generated documentation for the "${repoName}" codebase.

Docs: ${outputDir}/

=== PROGRESS ===

Before starting: echo "[archdoc fix] Applying corrections" >&2
After each fix: echo "[archdoc fix] Fixed: <doc> — <brief description>" >&2
When done: echo "[archdoc fix] DONE — all corrections applied" >&2

=== INSTRUCTIONS ===

The verification pass identified confirmed inaccuracies listed in issues.json below.
For each issue:

1. Read the relevant doc file
2. Find the section and text described by the issue
3. Replace only the inaccurate claim with the corrected text from the "fix" field
4. Make the minimal change — do not rewrite surrounding content or improve prose
5. If multiple issues affect the same doc, apply all fixes in a single pass

After all fixes are applied, write ${outputDir}/issues-resolved.json:

[
  {
    "claim": "original claim text",
    "status": "fixed" | "not-found" | "skipped",
    "note": "brief explanation if not fixed"
  }
]

=== ISSUES ===

\`\`\`json
${issuesJson}
\`\`\`

=== GO ===

Apply each fix surgically. Only change the text that is wrong.`;
}
