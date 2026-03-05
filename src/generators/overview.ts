import { basename } from "path";
import type { CodeStatsHarvest, FeatureCensusHarvest, GitAnalysisHarvest } from "../types/harvest.js";
import type { GeneratorDescriptor, HarvestBag } from "../types/tool.js";
import { getHarvestData } from "../types/tool.js";

export const overviewGenerator: GeneratorDescriptor = {
  id: "overview",
  name: "Overview",
  requiredHarvests: [
    { toolId: "scc" },
    { toolId: "repo-feature-check" },
    { toolId: "git-analysis", optional: true },
  ],
  pageDefaults: {
    title: "Overview",
    slug: "overview",
    order: 1,
    tags: ["overview", "architecture", "summary"],
    crossRefs: ["code-stats", "feature-census"],
  },
  generate: (bag) => {
    const codeStats = getHarvestData<CodeStatsHarvest>(bag, "scc");
    const features = getHarvestData<FeatureCensusHarvest>(bag, "repo-feature-check");
    if (!codeStats || !features) return null;
    const gitAnalysis = getHarvestData<GitAnalysisHarvest>(bag, "git-analysis");
    return {
      frontmatter: { ...overviewGenerator.pageDefaults },
      content: buildContent(bag, codeStats, features, gitAnalysis),
    };
  },
};

function buildContent(
  bag: HarvestBag,
  codeStats: CodeStatsHarvest,
  features: FeatureCensusHarvest,
  gitAnalysis: GitAnalysisHarvest | undefined
): string {
  const repoName = basename(bag.targetPath);
  const sections: string[] = [];

  sections.push(`# Overview: ${repoName}\n`);

  // Key numbers table
  sections.push("## Key Numbers\n");
  sections.push("| Metric | Value |");
  sections.push("|--------|-------|");
  sections.push(`| Lines of Code | ${codeStats.totalCode.toLocaleString()} |`);
  sections.push(`| Files | ${codeStats.totalFiles.toLocaleString()} |`);
  sections.push(`| Languages | ${codeStats.languages.length} |`);
  sections.push(`| Symbols | ${features.totalSymbols.toLocaleString()} |`);
  sections.push(`| Modules | ${features.totalFeatures} |`);
  if (gitAnalysis) {
    sections.push(`| Commits | ${gitAnalysis.totalCommits.toLocaleString()} |`);
    sections.push(`| Contributors | ${gitAnalysis.contributors} |`);
    sections.push(`| Active Since | ${gitAnalysis.firstCommitDate.slice(0, 10)} |`);
  }
  sections.push("");

  // Tech stack
  sections.push("## Tech Stack\n");
  const topLangs = codeStats.languages.slice(0, 8);
  sections.push("| Language | LOC | Share |");
  sections.push("|----------|----:|------:|");
  for (const lang of topLangs) {
    const pct = ((lang.Code / codeStats.totalCode) * 100).toFixed(1);
    sections.push(`| ${lang.Name} | ${lang.Code.toLocaleString()} | ${pct}% |`);
  }
  sections.push("");

  // Module structure
  sections.push("## Top Modules\n");
  const topModules = features.directoryGroups.slice(0, 10);
  sections.push("| Module | Symbols | Description |");
  sections.push("|--------|--------:|-------------|");
  for (const m of topModules) {
    const desc = inferModuleDescription(m.directory, m.sampleSymbols);
    sections.push(`| \`${m.directory}\` | ${m.total} | ${desc} |`);
  }
  sections.push("");

  // Active development areas (git-dependent)
  if (gitAnalysis) {
    sections.push("## Active Development Areas\n");
    sections.push("Most-changed files (by commit count):\n");
    const topChurn = gitAnalysis.topChurnFiles.slice(0, 10);
    for (const f of topChurn) {
      sections.push(`- \`${f.path}\` \u2014 ${f.commits} commits (+${f.insertions}/-${f.deletions})`);
    }
    sections.push("");

    if (gitAnalysis.recentActivity.length > 0) {
      sections.push("## Recent Activity (last 30 days)\n");
      const totalRecent = gitAnalysis.recentActivity.reduce((s, d) => s + d.commits, 0);
      const activeDays = gitAnalysis.recentActivity.length;
      sections.push(`${totalRecent} commits across ${activeDays} active days.\n`);
    }
  }

  sections.push("---\n");
  sections.push("*See [[Code Statistics]] for detailed language breakdown, [[Feature Census]] for feature-by-feature analysis.*\n");
  sections.push("*Run `archdoc enrich` to generate AI-enhanced narrative descriptions for this page.*\n");

  return sections.join("\n");
}

function inferModuleDescription(dir: string, symbols: string[]): string {
  const last = dir.split("/").pop() || dir;
  const symHint = symbols.slice(0, 2).join(", ");

  const known: Record<string, string> = {
    tests: "Test suite",
    api: "API endpoints and routes",
    models: "Data models / ORM",
    services: "Business logic services",
    repositories: "Data access layer",
    jobs: "Background jobs and workers",
    core: "Core framework and config",
    scripts: "CLI scripts and utilities",
    alembic: "Database migrations",
    adapters: "External service adapters",
  };

  if (known[last]) return known[last];
  return symHint ? `e.g. ${symHint}` : "\u2014";
}
