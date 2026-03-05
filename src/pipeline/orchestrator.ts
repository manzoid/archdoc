import { resolve, basename } from "path";
import { mkdir } from "fs/promises";
import chalk from "chalk";
import type { ArchdocConfig } from "../types/config.js";
import type { WikiPage } from "../types/wiki.js";
import type { HarvestBag } from "../types/tool.js";
import { runHarvest } from "./harvester.js";
import { runGenerate } from "./generator.js";
import { runAssemble } from "./assembler.js";

export async function runPipeline(config: ArchdocConfig): Promise<void> {
  const repoName = basename(config.targetPath);
  console.log(chalk.bold(`\narchdoc — generating wiki for ${chalk.cyan(repoName)}\n`));

  const harvestDir = resolve(config.harvestDir);
  const outputDir = resolve(config.outputDir);

  await mkdir(harvestDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  // Phase 1: HARVEST
  let bag: HarvestBag | undefined;
  if (!config.only || config.only === "harvest") {
    console.log(chalk.yellow("▸ Phase 1: HARVEST — collecting codebase data...\n"));
    bag = await runHarvest(config, harvestDir);
    if (config.only === "harvest") {
      console.log(chalk.green("\n✓ Harvest complete. Data in:"), harvestDir);
      return;
    }
  }

  // Phase 2: GENERATE
  let pages: WikiPage[] = [];
  if (!config.only || config.only === "generate") {
    console.log(chalk.yellow("\n▸ Phase 2: GENERATE — producing wiki pages...\n"));
    pages = await runGenerate(config, harvestDir);
    if (config.only === "generate") {
      console.log(chalk.green("\n✓ Generation complete."), `${pages.length} pages produced.`);
      return;
    }
  }

  // Phase 3: RENDER (skipped for Milestone 1 — no diagrams yet)

  // Phase 4: ASSEMBLE
  if (!config.only || config.only === "assemble") {
    console.log(chalk.yellow("\n▸ Phase 4: ASSEMBLE — writing output...\n"));
    await runAssemble(config, pages, outputDir, bag);
  }

  console.log(chalk.green.bold(`\n✓ Wiki generated!`), `${pages.length} pages in ${outputDir}/\n`);
}
