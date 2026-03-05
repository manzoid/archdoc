import { readFile } from "fs/promises";
import { join } from "path";
import chalk from "chalk";
import type { ArchdocConfig } from "../types/config.js";
import type { HarvestBag } from "../types/tool.js";
import type { WikiPage } from "../types/wiki.js";
import { generators } from "../registry.js";

export async function runGenerate(
  config: ArchdocConfig,
  harvestDir: string
): Promise<WikiPage[]> {
  const bagJson = await readFile(join(harvestDir, "harvest-bag.json"), "utf-8");
  const bag: HarvestBag = JSON.parse(bagJson);

  const pageFilter = config.pages ? new Set(config.pages) : null;
  const pages: WikiPage[] = [];

  for (const gen of generators) {
    // Filter by --pages if specified
    if (pageFilter && !pageFilter.has(gen.id)) continue;

    // Check required harvests
    const missingRequired = gen.requiredHarvests
      .filter((req) => !req.optional)
      .filter((req) => {
        const meta = bag.resultMeta[req.toolId];
        return !meta || meta.status !== "success";
      });

    if (missingRequired.length > 0) {
      const names = missingRequired.map((r) => r.toolId).join(", ");
      console.log(chalk.yellow(`  ⚠ ${gen.name} — skipped (missing harvests: ${names})`));
      continue;
    }

    console.log(chalk.dim(`  Generating: ${gen.name}...`));
    const page = gen.generate(bag, config);
    if (page) {
      pages.push(page);
      console.log(chalk.dim(`  ✓ ${gen.name}`));
    } else {
      console.log(chalk.yellow(`  ⚠ ${gen.name} — returned null`));
    }
  }

  return pages;
}
