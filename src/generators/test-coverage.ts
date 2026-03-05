import type { TestCensusHarvest } from "../types/harvest.js";
import type { GeneratorDescriptor } from "../types/tool.js";
import { getHarvestData } from "../types/tool.js";

export const testCoverageGenerator: GeneratorDescriptor = {
  id: "test-coverage",
  name: "Test Coverage",
  requiredHarvests: [{ toolId: "test-intent-map" }],
  pageDefaults: {
    title: "Test Coverage",
    slug: "test-coverage",
    order: 3,
    tags: ["tests", "quality"],
    crossRefs: ["code-stats", "feature-census", "overview"],
  },
  generate: (bag) => {
    const census = getHarvestData<TestCensusHarvest>(bag, "test-intent-map");
    if (!census) return null;
    return { frontmatter: { ...testCoverageGenerator.pageDefaults }, content: buildContent(census) };
  },
};

function buildContent(census: TestCensusHarvest): string {
  const sections: string[] = [];

  sections.push("# Test Coverage\n");

  // Summary
  sections.push("## Summary\n");
  sections.push("| Metric | Value |");
  sections.push("|--------|-------|");
  sections.push(`| **Test Files** | ${fmt(census.totals.testFiles)} |`);
  sections.push(`| **Test Classes** | ${fmt(census.totals.testClasses)} |`);
  sections.push(`| **Tests** | ${fmt(census.totals.tests)} |`);
  sections.push(`| **Languages** | ${census.languages.join(", ")} |`);

  const withSources = census.testFiles.filter((f) => f.inferredSources.length > 0).length;
  sections.push(`| **Source Inference** | ${withSources}/${census.totals.testFiles} files mapped |`);
  sections.push("");

  // Tests by language
  if (census.languages.length > 1) {
    sections.push("## Tests by Language\n");
    sections.push("| Language | Tests | % |");
    sections.push("|----------|------:|--:|");

    const langCounts = new Map<string, number>();
    for (const t of census.tests) {
      langCounts.set(t.language, (langCounts.get(t.language) || 0) + 1);
    }

    for (const [lang, count] of [...langCounts.entries()].sort((a, b) => b[1] - a[1])) {
      const pct = ((count / census.totals.tests) * 100).toFixed(1);
      sections.push(`| ${lang} | ${fmt(count)} | ${pct}% |`);
    }
    sections.push("");
  }

  // Tests by group
  sections.push("## Tests by Group\n");
  sections.push("| Group | Tests | Files | % |");
  sections.push("|-------|------:|------:|--:|");

  const groupStats = new Map<string, { tests: number; files: Set<string> }>();
  for (const t of census.tests) {
    const g = t.group || "(root)";
    if (!groupStats.has(g)) groupStats.set(g, { tests: 0, files: new Set() });
    const stat = groupStats.get(g)!;
    stat.tests++;
    stat.files.add(t.testFile);
  }

  const sortedGroups = [...groupStats.entries()].sort((a, b) => b[1].tests - a[1].tests);
  for (const [group, stat] of sortedGroups.slice(0, 20)) {
    const pct = ((stat.tests / census.totals.tests) * 100).toFixed(1);
    sections.push(`| ${group} | ${fmt(stat.tests)} | ${stat.files.size} | ${pct}% |`);
  }

  if (sortedGroups.length > 20) {
    const rest = sortedGroups.slice(20);
    const restTests = rest.reduce((s, [, v]) => s + v.tests, 0);
    sections.push(`| *${rest.length} others* | ${fmt(restTests)} | — | ${((restTests / census.totals.tests) * 100).toFixed(1)}% |`);
  }
  sections.push("");

  // Largest test files
  sections.push("## Largest Test Files\n");
  sections.push("| File | Tests | Sources Mapped |");
  sections.push("|------|------:|:--------------:|");

  const sorted = [...census.testFiles].sort((a, b) => b.testCount - a.testCount);
  for (const f of sorted.slice(0, 15)) {
    const mapped = f.inferredSources.length > 0 ? "yes" : "—";
    sections.push(`| ${f.path} | ${f.testCount} | ${mapped} |`);
  }
  sections.push("");

  sections.push("---\n");
  sections.push("*See also: [[Code Statistics]] for language breakdown, [[Feature Census]] for module mapping.*\n");

  return sections.join("\n");
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}
