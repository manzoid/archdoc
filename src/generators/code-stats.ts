import type { CodeStatsHarvest, LanguageStat } from "../types/harvest.js";
import type { GeneratorDescriptor } from "../types/tool.js";
import { getHarvestData } from "../types/tool.js";

export const codeStatsGenerator: GeneratorDescriptor = {
  id: "code-stats",
  name: "Code Stats",
  requiredHarvests: [{ toolId: "scc" }],
  pageDefaults: {
    title: "Code Statistics",
    slug: "code-stats",
    order: 2,
    tags: ["metrics", "languages"],
    crossRefs: ["feature-census", "overview"],
  },
  generate: (bag) => {
    const stats = getHarvestData<CodeStatsHarvest>(bag, "scc");
    if (!stats) return null;
    return { frontmatter: { ...codeStatsGenerator.pageDefaults }, content: buildContent(stats) };
  },
};

function buildContent(stats: CodeStatsHarvest): string {
  const sections: string[] = [];

  // Summary
  sections.push("# Code Statistics\n");
  sections.push("## Summary\n");
  sections.push(`| Metric | Value |`);
  sections.push(`|--------|-------|`);
  sections.push(`| **Total Files** | ${fmt(stats.totalFiles)} |`);
  sections.push(`| **Total Lines** | ${fmt(stats.totalLines)} |`);
  sections.push(`| **Lines of Code** | ${fmt(stats.totalCode)} |`);
  sections.push(`| **Comments** | ${fmt(stats.totalComment)} |`);
  sections.push(`| **Blank Lines** | ${fmt(stats.totalBlank)} |`);
  sections.push(`| **Complexity** | ${fmt(stats.totalComplexity)} |`);
  sections.push(`| **Languages** | ${stats.languages.length} |`);
  sections.push("");

  // Language breakdown
  sections.push("## Language Breakdown\n");
  sections.push(
    "| Language | Files | Code | Comments | Blank | Complexity | % of Code |"
  );
  sections.push(
    "|----------|------:|-----:|---------:|------:|-----------:|----------:|"
  );

  for (const lang of stats.languages.slice(0, 25)) {
    const pct = ((lang.Code / stats.totalCode) * 100).toFixed(1);
    sections.push(
      `| ${lang.Name} | ${fmt(lang.Count)} | ${fmt(lang.Code)} | ${fmt(lang.Comment)} | ${fmt(lang.Blank)} | ${fmt(lang.Complexity)} | ${pct}% |`
    );
  }

  if (stats.languages.length > 25) {
    const rest = stats.languages.slice(25);
    const restCode = rest.reduce((s, l) => s + l.Code, 0);
    const restFiles = rest.reduce((s, l) => s + l.Count, 0);
    const pct = ((restCode / stats.totalCode) * 100).toFixed(1);
    sections.push(
      `| *${rest.length} others* | ${fmt(restFiles)} | ${fmt(restCode)} | — | — | — | ${pct}% |`
    );
  }

  sections.push("");

  // Top languages bar chart (ASCII)
  sections.push("## Top Languages by Lines of Code\n");
  sections.push("```");
  const top10 = stats.languages.slice(0, 10);
  const maxCode = top10[0]?.Code || 1;
  const maxNameLen = Math.max(...top10.map((l: LanguageStat) => l.Name.length));

  for (const lang of top10) {
    const barLen = Math.round((lang.Code / maxCode) * 40);
    const bar = "\u2588".repeat(barLen);
    const name = lang.Name.padEnd(maxNameLen);
    sections.push(`  ${name}  ${bar} ${fmt(lang.Code)}`);
  }
  sections.push("```\n");

  // Complexity hotspots
  const byComplexity = [...stats.languages]
    .filter((l) => l.Complexity > 0)
    .sort((a, b) => b.WeightedComplexity - a.WeightedComplexity);

  if (byComplexity.length > 0) {
    sections.push("## Complexity by Language\n");
    sections.push("| Language | Complexity | Complexity/LOC |");
    sections.push("|----------|----------:|--------------:|");

    for (const lang of byComplexity.slice(0, 10)) {
      const ratio = lang.Code > 0 ? (lang.Complexity / lang.Code).toFixed(3) : "\u2014";
      sections.push(`| ${lang.Name} | ${fmt(lang.Complexity)} | ${ratio} |`);
    }
    sections.push("");
  }

  sections.push("---\n");
  sections.push("*See also: [[Feature Census]] for how these lines map to features.*\n");

  return sections.join("\n");
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}
