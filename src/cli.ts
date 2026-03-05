#!/usr/bin/env node

import { Command } from "commander";
import { resolve, basename } from "path";
import { readdir, stat } from "fs/promises";
import { homedir } from "os";
import { runPipeline } from "./pipeline/orchestrator.js";
import { runEnrich } from "./pipeline/enrich-runner.js";
import { listEnrichSteps, generateStepPrompt, generateAllStepsPrompt } from "./prompts/enrich.js";
import { renderBareHtml } from "./renderers/html-bare.js";
import { renderSiteHtml } from "./renderers/html-site.js";
import { renderDiagrams } from "./renderers/diagrams.js";
import type { ArchdocConfig, OutputFormat, PipelinePhase } from "./types/config.js";
import { defaultDirs } from "./types/config.js";

const program = new Command();

program
  .name("archdoc")
  .description("AI-powered codebase wiki generator")
  .version("0.1.0");

/**
 * Derive the slug prefix for a target path (matches defaultDirs logic).
 */
function repoSlug(targetPath: string): string {
  const parts = targetPath.replace(/\\/g, "/").split("/");
  const ghIdx = parts.indexOf("github.com");
  if (ghIdx >= 0 && parts.length > ghIdx + 2) {
    return parts.slice(ghIdx + 1).join("-");
  }
  return basename(targetPath);
}

/**
 * Find the most recent archdoc run for a given repo under /tmp/archdoc/.
 * Returns { outputDir, harvestDir } or null if none found.
 */
async function findLatestRun(targetPath: string): Promise<{ baseDir: string; outputDir: string; harvestDir: string } | null> {
  const slug = repoSlug(targetPath);
  const archdocTmp = `${homedir()}/archdoc-runs`;
  let entries: string[];
  try {
    entries = await readdir(archdocTmp);
  } catch {
    return null;
  }

  const matching = entries
    .filter((e) => e.startsWith(`${slug}-`))
    .sort()
    .reverse();

  for (const dir of matching) {
    const baseDir = `${archdocTmp}/${dir}`;
    const s = await stat(baseDir).catch(() => null);
    if (s?.isDirectory()) {
      return {
        baseDir,
        outputDir: `${baseDir}/output`,
        harvestDir: `${baseDir}/harvest`,
      };
    }
  }
  return null;
}

// Main command: generate wiki
program
  .command("generate", { isDefault: true })
  .description("Generate wiki pages from codebase analysis")
  .argument("<target>", "Path to the codebase to document")
  .option("--output <format>", "Output format: site or markdown", "markdown")
  .option("--output-dir <dir>", "Override output directory")
  .option("--harvest-dir <dir>", "Override harvest directory")
  .option("--only <phase>", "Run only a specific phase: harvest, generate, render, assemble")
  .option("--pages <pages>", "Comma-separated list of pages to generate")
  .option("--churn-since <date>", "Start date for churn analysis (YYYY-MM-DD)")
  .option("--skip-tools <tools>", "Comma-separated list of tool IDs to skip")
  .action(async (target: string, options) => {
    const targetPath = resolve(target);
    const dirs = defaultDirs(targetPath);
    const config: ArchdocConfig = {
      targetPath,
      output: options.output as OutputFormat,
      outputDir: options.outputDir ? resolve(options.outputDir) : dirs.outputDir,
      harvestDir: options.harvestDir ? resolve(options.harvestDir) : dirs.harvestDir,
      only: options.only as PipelinePhase | undefined,
      pages: options.pages ? options.pages.split(",").map((p: string) => p.trim()) : undefined,
      churnSince: options.churnSince,
      skipTools: options.skipTools ? options.skipTools.split(",").map((t: string) => t.trim()) : undefined,
    };
    try {
      await runPipeline(config);
      console.log(`Run directory: ${dirs.baseDir}`);
    } catch (err) {
      console.error("archdoc failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Enrich command: output AI prompt for the running agent
program
  .command("enrich")
  .description("Output AI enrichment prompts — pipe to your coding agent or copy-paste")
  .argument("<target>", "Path to the codebase (locates latest run under /tmp/archdoc/)")
  .option("--harvest-dir <dir>", "Override harvest directory")
  .option("--output-dir <dir>", "Override output directory")
  .option("--step <number>", "Output prompt for a specific step number")
  .option("--all", "Output all steps as one sequenced prompt")
  .action(async (target: string, options) => {
    try {
      const targetPath = resolve(target);
      const latest = await findLatestRun(targetPath);
      const harvestDir = options.harvestDir ? resolve(options.harvestDir) : latest?.harvestDir;
      const outputDir = options.outputDir ? resolve(options.outputDir) : latest?.outputDir;

      if (!harvestDir || !outputDir) {
        console.error(`No archdoc run found for ${basename(targetPath)}. Run 'archdoc generate' first.`);
        process.exit(1);
      }

      if (options.step) {
        const stepNum = parseInt(options.step, 10);
        if (isNaN(stepNum)) {
          console.error("--step must be a number");
          process.exit(1);
        }
        const prompt = await generateStepPrompt(harvestDir, outputDir, stepNum);
        console.log(prompt);
      } else if (options.all) {
        const prompt = await generateAllStepsPrompt(harvestDir, outputDir);
        console.log(prompt);
      } else {
        console.log(`Using run: ${latest?.baseDir ?? "(custom dirs)"}\n`);
        console.log(listEnrichSteps());
      }
    } catch (err) {
      console.error("archdoc enrich failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Render command: produce HTML from assembled output
program
  .command("render")
  .description("Render assembled wiki pages to HTML")
  .argument("<target>", "Path to the codebase (locates latest run under /tmp/archdoc/)")
  .option("--output-dir <dir>", "Override output directory containing manifest.json")
  .option("--format <format>", "Render format: bare or site", "bare")
  .action(async (target: string, options) => {
    try {
      const targetPath = resolve(target);
      const latest = await findLatestRun(targetPath);
      const outputDir = options.outputDir ? resolve(options.outputDir) : latest?.outputDir;

      if (!outputDir) {
        console.error(`No archdoc run found for ${basename(targetPath)}. Run 'archdoc generate' first.`);
        process.exit(1);
      }

      console.log(`Using run: ${latest?.baseDir ?? "(custom dir)"}`);

      // Render D2 diagrams first (produces SVGs that HTML renderers reference)
      const diagResults = await renderDiagrams(outputDir);
      if (diagResults.length > 0) {
        console.log(`  ${diagResults.filter((d) => d.status === "success").length} diagram(s) rendered\n`);
      }

      if (options.format === "bare") {
        console.log("Rendering bare HTML site...\n");
        await renderBareHtml(outputDir);
        console.log(`\nSite written to ${outputDir}/site/`);
      } else if (options.format === "site") {
        console.log("Rendering interactive site...\n");
        await renderSiteHtml(outputDir);
        console.log(`\nSite written to ${outputDir}/site-fancy/`);
      } else {
        console.error(`Unknown render format: ${options.format}. Use 'bare' or 'site'.`);
        process.exit(1);
      }
    } catch (err) {
      console.error("archdoc render failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Full pipeline: generate → enrich (AI) → render
program
  .command("run")
  .description("Run the full pipeline: generate → enrich (AI) → render")
  .argument("<target>", "Path to the codebase to document")
  .option("--model <model>", "Claude model for enrichment (passed to claude CLI)")
  .option("--render-format <format>", "Render format: bare or site", "site")
  .option("--churn-since <date>", "Start date for churn analysis (YYYY-MM-DD)")
  .option("--skip-tools <tools>", "Comma-separated list of tool IDs to skip")
  .action(async (target: string, options) => {
    const targetPath = resolve(target);
    const dirs = defaultDirs(targetPath);
    const config: ArchdocConfig = {
      targetPath,
      output: "markdown",
      outputDir: dirs.outputDir,
      harvestDir: dirs.harvestDir,
      churnSince: options.churnSince,
      skipTools: options.skipTools ? options.skipTools.split(",").map((t: string) => t.trim()) : undefined,
    };

    try {
      // Phase 1+2+4: generate
      await runPipeline(config);

      // Phase: enrich (AI)
      const chalk = (await import("chalk")).default;
      console.log(chalk.yellow("\n▸ Phase: ENRICH — AI writing narrative pages...\n"));
      await runEnrich(dirs.harvestDir, dirs.outputDir, { model: options.model });
      console.log(chalk.green("\n✓ Enrichment complete!\n"));

      // Phase: render
      console.log(chalk.yellow("▸ Phase: RENDER — producing HTML site...\n"));
      const diagResults = await renderDiagrams(dirs.outputDir);
      if (diagResults.length > 0) {
        console.log(`  ${diagResults.filter((d) => d.status === "success").length} diagram(s) rendered`);
      }

      if (options.renderFormat === "site") {
        await renderSiteHtml(dirs.outputDir);
        console.log(chalk.green(`\n✓ Site written to ${dirs.outputDir}/site-fancy/`));
      } else {
        await renderBareHtml(dirs.outputDir);
        console.log(chalk.green(`\n✓ Site written to ${dirs.outputDir}/site/`));
      }

      console.log(`\nRun directory: ${dirs.baseDir}`);
    } catch (err) {
      console.error("archdoc run failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parse();
