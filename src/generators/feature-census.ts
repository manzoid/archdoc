import type { FeatureCensusHarvest, GitAnalysisHarvest, FileChurn } from "../types/harvest.js";
import type { GeneratorDescriptor } from "../types/tool.js";
import { getHarvestData } from "../types/tool.js";

export const featureCensusGenerator: GeneratorDescriptor = {
  id: "feature-census",
  name: "Feature Census",
  requiredHarvests: [{ toolId: "repo-feature-check" }],
  pageDefaults: {
    title: "Feature Census",
    slug: "feature-census",
    order: 3,
    tags: ["features", "architecture", "metrics"],
    crossRefs: ["code-stats", "overview"],
  },
  generate: (bag) => {
    const features = getHarvestData<FeatureCensusHarvest>(bag, "repo-feature-check");
    if (!features) return null;
    const git = getHarvestData<GitAnalysisHarvest>(bag, "git-analysis");
    return { frontmatter: { ...featureCensusGenerator.pageDefaults }, content: buildContent(features, git) };
  },
};

function buildContent(features: FeatureCensusHarvest, git: GitAnalysisHarvest | undefined): string {
  const sections: string[] = [];

  sections.push("# Feature Census\n");
  sections.push(
    `> **${features.totalFeatures}** module areas encompassing ` +
    `**${features.totalSymbols.toLocaleString()}** symbols ` +
    `(${features.totals.functions.toLocaleString()} functions, ` +
    `${features.totals.methods.toLocaleString()} methods, ` +
    `${features.totals.classes.toLocaleString()} classes)\n`
  );

  // Build churn-per-module map
  const moduleChurn = new Map<string, { churn: number; commits: number; topFiles: FileChurn[] }>();
  if (git) {
    for (const g of features.directoryGroups) {
      const moduleFiles = git.topChurnFiles.filter((f) => f.path.startsWith(g.directory + "/") || f.path.startsWith(g.directory));
      const churn = moduleFiles.reduce((s, f) => s + f.insertions + f.deletions, 0);
      const commits = moduleFiles.reduce((s, f) => s + f.commits, 0);
      moduleChurn.set(g.directory, { churn, commits, topFiles: moduleFiles.slice(0, 3) });
    }
  }

  // Module table with churn
  sections.push("## Module Map\n");
  if (git) {
    sections.push("| Module | Symbols | F | M | C | Churn | Hotspot | Sample Symbols |");
    sections.push("|--------|--------:|--:|--:|--:|------:|---------|----------------|");
  } else {
    sections.push("| Module | Symbols | F | M | C | Sample Symbols |");
    sections.push("|--------|--------:|--:|--:|--:|----------------|");
  }

  const topGroups = features.directoryGroups.slice(0, 30);
  const maxChurn = Math.max(...[...moduleChurn.values()].map((v) => v.churn), 1);

  for (const g of topGroups) {
    const samples = g.sampleSymbols.slice(0, 3).map((s) => `\`${s}\``).join(", ");
    if (git) {
      const mc = moduleChurn.get(g.directory);
      const churn = mc?.churn ?? 0;
      const hotspot = churn > maxChurn * 0.6 ? "HIGH" : churn > maxChurn * 0.2 ? "MED" : "LOW";
      sections.push(
        `| **${g.directory}** | ${g.total} | ${g.functions} | ${g.methods} | ${g.classes} | ${fmt(churn)} | ${hotspot} | ${samples} |`
      );
    } else {
      sections.push(
        `| **${g.directory}** | ${g.total} | ${g.functions} | ${g.methods} | ${g.classes} | ${samples} |`
      );
    }
  }

  if (features.directoryGroups.length > 30) {
    const rest = features.directoryGroups.slice(30);
    const restTotal = rest.reduce((s, g) => s + g.total, 0);
    const cols = git ? "— | — | — | — | — |" : "— | — | — |";
    sections.push(`| *${rest.length} other modules* | ${restTotal} | ${cols}`);
  }

  sections.push("");
  sections.push("*Column key: F=functions, M=methods, C=classes. Churn=insertions+deletions. Hotspot relative to max churn module.*\n");

  // Top hotspot files
  if (git && git.topChurnFiles.length > 0) {
    sections.push("## Top Hotspot Files\n");
    sections.push("| Churn | Commits | Module | File |");
    sections.push("|------:|--------:|--------|------|");

    const topFiles = git.topChurnFiles.slice(0, 20);
    for (const f of topFiles) {
      const churn = f.insertions + f.deletions;
      const module = features.directoryGroups.find((g) =>
        f.path.startsWith(g.directory + "/") || f.path.startsWith(g.directory)
      )?.directory ?? "(other)";
      sections.push(`| ${fmt(churn)} | ${f.commits} | ${module} | ${f.path} |`);
    }
    sections.push("");
  }

  // Size distribution
  sections.push("## Size Distribution\n");
  const large = features.directoryGroups.filter((g) => g.total >= 50);
  const medium = features.directoryGroups.filter((g) => g.total >= 10 && g.total < 50);
  const small = features.directoryGroups.filter((g) => g.total < 10);
  sections.push(`- **Large modules** (50+ symbols): ${large.length}${large.length > 0 ? " — " + large.map((g) => g.directory).join(", ") : ""}`);
  sections.push(`- **Medium modules** (10-49 symbols): ${medium.length}`);
  sections.push(`- **Small modules** (<10 symbols): ${small.length}`);
  sections.push("");

  // Composition
  const totalF = features.totals.functions;
  const totalM = features.totals.methods;
  const totalC = features.totals.classes;
  const total = totalF + totalM + totalC;
  if (total > 0) {
    sections.push("## Symbol Composition\n");
    sections.push("```");
    const fBar = Math.round((totalF / total) * 40);
    const mBar = Math.round((totalM / total) * 40);
    const cBar = Math.round((totalC / total) * 40);
    sections.push(`  Functions  ${"█".repeat(fBar)} ${fmt(totalF)} (${pct(totalF, total)})`);
    sections.push(`  Methods    ${"█".repeat(mBar)} ${fmt(totalM)} (${pct(totalM, total)})`);
    sections.push(`  Classes    ${"█".repeat(cBar)} ${fmt(totalC)} (${pct(totalC, total)})`);
    sections.push("```\n");
  }

  sections.push("---\n");
  sections.push("*See also: [[Code Statistics]] for language breakdown, [[Overview]] for system summary.*\n");

  return sections.join("\n");
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function pct(n: number, total: number): string {
  return total > 0 ? ((n / total) * 100).toFixed(1) + "%" : "0%";
}
