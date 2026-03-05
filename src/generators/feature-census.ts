import type { FeatureCensusHarvest } from "../types/harvest.js";
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
    return { frontmatter: { ...featureCensusGenerator.pageDefaults }, content: buildContent(features) };
  },
};

function buildContent(features: FeatureCensusHarvest): string {
  const sections: string[] = [];

  sections.push("# Feature Census\n");
  sections.push(
    `> **${features.totalFeatures}** module areas encompassing ` +
    `**${features.totalSymbols.toLocaleString()}** symbols ` +
    `(${features.totals.functions.toLocaleString()} functions, ` +
    `${features.totals.methods.toLocaleString()} methods, ` +
    `${features.totals.classes.toLocaleString()} classes)\n`
  );

  // Main module table
  sections.push("## Module Map\n");
  sections.push("| Module | Symbols | F | M | C | Sample Symbols |");
  sections.push("|--------|--------:|--:|--:|--:|----------------|");

  const topGroups = features.directoryGroups.slice(0, 30);
  for (const g of topGroups) {
    const samples = g.sampleSymbols.slice(0, 3).map((s) => `\`${s}\``).join(", ");
    sections.push(
      `| **${g.directory}** | ${g.total} | ${g.functions} | ${g.methods} | ${g.classes} | ${samples} |`
    );
  }

  if (features.directoryGroups.length > 30) {
    const rest = features.directoryGroups.slice(30);
    const restTotal = rest.reduce((s, g) => s + g.total, 0);
    sections.push(`| *${rest.length} other modules* | ${restTotal} | — | — | — | — |`);
  }

  sections.push("");
  sections.push("*Column key: F=functions, M=methods, C=classes*\n");

  // Size distribution
  sections.push("## Size Distribution\n");
  const large = features.directoryGroups.filter((g) => g.total >= 50);
  const medium = features.directoryGroups.filter((g) => g.total >= 10 && g.total < 50);
  const small = features.directoryGroups.filter((g) => g.total < 10);
  sections.push(`- **Large modules** (50+ symbols): ${large.length} — ${large.map((g) => g.directory).join(", ")}`);
  sections.push(`- **Medium modules** (10-49 symbols): ${medium.length}`);
  sections.push(`- **Small modules** (<10 symbols): ${small.length}`);
  sections.push("");

  sections.push("---\n");
  sections.push("*See also: [[Code Statistics]] for language breakdown, [[Overview]] for system summary.*\n");

  return sections.join("\n");
}
